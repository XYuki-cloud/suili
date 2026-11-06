package app.flexible.calendar;

import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.List;

public final class HttpSyncTransport implements SyncTransport {
    static final class HttpFailure extends IOException {final boolean retryable;HttpFailure(int code){super(code==401?"配对令牌不正确（401）":"同步服务返回 HTTP "+code);retryable=code>=500||code==408||code==429;}}
    private final URL url;
    private final String token;
    private volatile HttpURLConnection activeConnection;
    private volatile boolean cancelled;
    public void testConnection() throws Exception {
        if(cancelled)throw new InterruptedIOException("同步已暂停");HttpURLConnection connection=(HttpURLConnection)url.openConnection();activeConnection=connection;
        try{connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("GET");connection.setRequestProperty("Authorization","Bearer "+token);int code=connection.getResponseCode();if(code!=200)throw new HttpFailure(code);
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){output.write(buffer,0,n);if(output.size()>20*1024*1024)throw new IOException("响应超过限制");}JsonCodec.decode(output.toString(StandardCharsets.UTF_8.name()));}
        }finally{activeConnection=null;connection.disconnect();}
    }
    public void cancel(){cancelled=true;HttpURLConnection active=activeConnection;if(active!=null)active.disconnect();}
    public HttpSyncTransport(String baseUrl,String token) throws Exception {URI base=new URI(baseUrl.trim());if(!("http".equals(base.getScheme())||"https".equals(base.getScheme()))||base.getHost()==null||base.getUserInfo()!=null||base.getQuery()!=null||base.getFragment()!=null)throw new IllegalArgumentException("请输入完整的 http(s) 服务地址，不包含凭据或查询参数");if(token.trim().isEmpty()||token.contains("\r")||token.contains("\n"))throw new IllegalArgumentException("请输入配对令牌");this.url=new URL(baseUrl.replaceAll("/+$","")+"/api/sync");this.token=token.trim();}
    @Override public List<Core.Op> exchange(List<Core.Op> local) throws Exception {if(cancelled)throw new InterruptedIOException("同步已暂停");HttpURLConnection connection=(HttpURLConnection)url.openConnection();activeConnection=connection;try{if(cancelled)throw new InterruptedIOException("同步已暂停");connection.setConnectTimeout(10000);connection.setReadTimeout(15000);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("POST");connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setDoOutput(true);byte[] body=JsonCodec.encode(local).getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);try(OutputStream out=connection.getOutputStream()){out.write(body);}int code=connection.getResponseCode();if(code!=200)throw new HttpFailure(code);try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){out.write(buffer,0,n);if(out.size()>20*1024*1024)throw new IOException("同步响应超过 20 MB 限制");}if(cancelled)throw new InterruptedIOException("同步已暂停");return JsonCodec.decode(out.toString(StandardCharsets.UTF_8.name()));}}finally{activeConnection=null;connection.disconnect();}}
}
