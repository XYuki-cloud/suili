package app.flexible.calendar;

import java.io.*;
import java.net.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.*;
import java.util.concurrent.*;

/** A complete operation log at one user-selected file; no unconditional writes or redirects. */
public final class WebDavTransport implements SyncTransport {
    static final int MAX_BYTES=10*1024*1024, MAX_ATTEMPTS=5;
    private static final ScheduledExecutorService DEADLINES=Executors.newSingleThreadScheduledExecutor(action->{Thread thread=new Thread(action,"WebDAV deadline");thread.setDaemon(true);return thread;});
    public static final class Failure extends IOException {
        final boolean retryable;
        Failure(String message,boolean retryable){super(message);this.retryable=retryable;}
    }
    private final URL url;
    private final String authorization;
    private volatile HttpURLConnection activeConnection;
    private volatile boolean cancelled;
    private volatile boolean deadlineExpired;

    public WebDavTransport(String fileUrl,String username,String password) throws Exception {
        url=new URI(validateUrl(fileUrl)).toURL();
        if(username==null||password==null||username.isEmpty()!=password.isEmpty()||username.indexOf(':')>=0||controls(username)||controls(password)||!StandardCharsets.UTF_8.newEncoder().canEncode(username)||!StandardCharsets.UTF_8.newEncoder().canEncode(password))
            throw new IllegalArgumentException("WebDAV 用户名与密码须同时填写或同时留空，不能包含控制字符；用户名不能包含冒号");
        authorization=username.isEmpty()?null:"Basic "+Base64.getEncoder().encodeToString((username+":"+password).getBytes(StandardCharsets.UTF_8));
    }
    static String validateUrl(String value) {
        try {
            URI uri=new URI(value==null?"":value.trim());String scheme=uri.getScheme(),path=uri.getRawPath();
            if(!("http".equalsIgnoreCase(scheme)||"https".equalsIgnoreCase(scheme))||uri.getHost()==null||uri.getUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||uri.getPort()>65535||path==null||path.isEmpty()||path.endsWith("/"))throw new IllegalArgumentException();
            for(String original:path.split("/",-1)){
                String segment=original;
                for(int depth=0;depth<=8;depth++){
                    if(segment.equals(".")||segment.equals("..")||segment.indexOf('/')>=0||segment.indexOf('\\')>=0||controls(segment))throw new IllegalArgumentException();
                    if(!segment.contains("%"))break;if(depth==8)throw new IllegalArgumentException();
                    segment=URLDecoder.decode(segment.replace("+","%2B"),StandardCharsets.UTF_8.name());if(segment.indexOf('\ufffd')>=0)throw new IllegalArgumentException();
                }
            }
            return uri.toASCIIString();
        }catch(Exception invalid){throw new IllegalArgumentException("请输入完整的 http(s) WebDAV JSON 文件地址，不包含用户名、密码、查询参数或片段");}
    }
    private static boolean controls(String value){return value.chars().anyMatch(character->character<32||character==127);}
    static boolean strongEtag(String value){return value!=null&&value.length()<=1024&&value.matches("\"[\\x21\\x23-\\x7E\\x80-\\xFF]*\"");}
    static boolean usableEtag(String value){
        if(strongEtag(value))return true;
        // Jianguoyun returns bare opaque ETags. Preserve that exact value for If-Match.
        return value!=null&&value.length()<=1024&&!value.startsWith("W/")&&!value.startsWith("w/")&&value.matches("[A-Za-z0-9][A-Za-z0-9._~+/:=-]*");
    }
    @Override public void cancel(){cancelled=true;HttpURLConnection connection=activeConnection;if(connection!=null)connection.disconnect();}
    private void checkCancelled() throws IOException {if(deadlineExpired)throw new Failure("WebDAV 本轮同步超过 30 秒，已停止；离线修改已保留",true);if(cancelled||Thread.currentThread().isInterrupted())throw new InterruptedIOException("同步已暂停，离线修改已保留");}
    private ScheduledFuture<?> deadline(){return DEADLINES.schedule(()->{deadlineExpired=true;cancel();},30,TimeUnit.SECONDS);}
    private static Failure status(int code){
        if(code>=300&&code<400)return new Failure("WebDAV 返回重定向；请填入最终文件地址（未转发凭据）",false);
        if(code==401||code==403)return new Failure("WebDAV 认证或访问权限失败（HTTP "+code+"），请检查用户名、密码及文件权限",false);
        if(code==409)return new Failure("WebDAV 目标文件夹不存在或路径冲突（HTTP 409）；请先在网盘中创建父文件夹，再填入其中的 JSON 文件地址",false);
        if(code==404)return new Failure("WebDAV 文件暂时不存在，请重新同步；父文件夹须已创建（HTTP 404）",false);
        return new Failure("WebDAV 返回 HTTP "+code+"，离线修改已保留",code>=500||code==408||code==429);
    }
    private HttpURLConnection connection(String method) throws Exception {
        checkCancelled();HttpURLConnection connection=(HttpURLConnection)url.openConnection();activeConnection=connection;
        connection.setConnectTimeout(10_000);connection.setReadTimeout(15_000);connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
        connection.setRequestMethod(method);if(authorization!=null)connection.setRequestProperty("Authorization",authorization);connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Cache-Control","no-cache");checkCancelled();return connection;
    }
    private static final class Remote {
        final List<Core.Op> operations;final String etag;final boolean missing;
        Remote(List<Core.Op> operations,String etag,boolean missing){this.operations=operations;this.etag=etag;this.missing=missing;}
    }
    private Remote read() throws Exception {
        HttpURLConnection connection=connection("GET");
        try {
            int code=connection.getResponseCode();checkCancelled();
            if(code==404)return new Remote(Collections.emptyList(),null,true);
            if(code!=200)throw status(code);
            String etag=connection.getHeaderField("ETag");
            if(!usableEtag(etag))throw new Failure("WebDAV 未提供可用于条件写入的 ETag，无法安全合并；弱、缺失或格式无效的 ETag 不能用于同步",false);
            if(connection.getContentLengthLong()>MAX_BYTES)throw new Failure("WebDAV 文件超过 10 MB，未修改远程数据",false);
            byte[] bytes;
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int count;
                while((count=input.read(buffer))!=-1){checkCancelled();if(output.size()+count>MAX_BYTES)throw new Failure("WebDAV 文件超过 10 MB，未修改远程数据",false);output.write(buffer,0,count);}bytes=output.toByteArray();
            }
            try {
                String raw=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                return new Remote(JsonCodec.decode(raw),etag,false);
            }catch(Exception invalid){throw new Failure("WebDAV 数据格式或操作历史无效，未修改远程数据",false);}
        }finally{activeConnection=null;connection.disconnect();}
    }
    /** Read-only connection check. A missing file is valid and is created by a later sync. */
    public boolean testConnection() throws Exception {
        ScheduledFuture<?> timer=deadline();
        try{return !read().missing;}catch(Failure safe){throw safe;}catch(Exception network){checkCancelled();throw new Failure("WebDAV 网络连接未完成，请检查地址、网络和 TLS 证书",true);}finally{timer.cancel(false);}
    }
    private boolean write(List<Core.Op> operations,Remote remote) throws Exception {
        byte[] body=JsonCodec.encode(operations).getBytes(StandardCharsets.UTF_8);
        if(body.length>MAX_BYTES)throw new Failure("合并后的日志超过 10 MB，未写入远程数据",false);
        HttpURLConnection connection=connection("PUT");
        try {
            connection.setRequestProperty(remote.missing?"If-None-Match":"If-Match",remote.missing?"*":remote.etag);
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);
            try(OutputStream output=connection.getOutputStream()){output.write(body);}checkCancelled();int code=connection.getResponseCode();
            if(code==412)return false;if(code!=200&&code!=201&&code!=204)throw status(code);return true;
        }finally{activeConnection=null;connection.disconnect();}
    }
    @Override public List<Core.Op> exchange(List<Core.Op> local) throws Exception {
        ScheduledFuture<?> timer=deadline();
        try {
            List<Core.Op> merged;
            try{merged=Core.merge(Collections.emptyList(),local);}catch(IllegalArgumentException invalid){throw new Failure("本地操作历史无效，未发起 WebDAV 写入",false);}
            for(int attempt=0;attempt<MAX_ATTEMPTS;attempt++){
                Remote remote=read();
                try{merged=Core.merge(merged,remote.operations);}catch(IllegalArgumentException collision){throw new Failure("WebDAV 操作 ID 内容冲突，双方历史均保留，未写入远程数据",false);}
                if(!write(merged,remote))continue;
                Remote confirmed=read();
                if(confirmed.missing)throw new Failure("WebDAV 写入后未能确认文件，稍后重试；本地仍保留待同步状态",true);
                Map<String,Core.Op> saved=new HashMap<>();for(Core.Op operation:confirmed.operations)saved.put(operation.id,operation);
                for(Core.Op operation:merged)if(!operation.equals(saved.get(operation.id)))throw new Failure("WebDAV 写入后未能确认完整历史，稍后重试；本地仍保留待同步状态",true);
                try{return Core.merge(merged,confirmed.operations);}catch(IllegalArgumentException collision){throw new Failure("WebDAV 确认时发现操作 ID 内容冲突，本地仍保留待同步状态",false);}
            }
            throw new Failure("WebDAV 文件被频繁修改，已停止本轮同步，请稍后重试",true);
        }catch(Failure safe){throw safe;}
        catch(Exception network){checkCancelled();throw new Failure("WebDAV 网络连接未完成，请检查地址、网络和 TLS 证书；离线修改已保留",true);}
        finally{timer.cancel(false);}
    }
}
