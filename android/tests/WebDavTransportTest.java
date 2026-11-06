package app.flexible.calendar;

import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Real local HTTP exchanges against the production transport; no Android dependencies. */
public final class WebDavTransportTest {
    interface Checked { void run() throws Exception; }
    interface Handler { void handle(HttpExchange request) throws Exception; }
    static int passed;
    static final String USER="测试账户ü", PASSWORD="private-password-汉字";
    static void truth(boolean value){if(!value)throw new AssertionError("Assertion failed");}
    static void check(String name,Checked action)throws Exception{action.run();passed++;System.out.println("PASS "+name);}
    static Core.Op op(String id){return new Core.Op(id,new Core.Task(UUID.randomUUID().toString(),id),Collections.emptyList(),"host-test","2026-10-25T10:00:00Z");}
    static WebDavTransport transport(String url)throws Exception{
        try{return WebDavTransport.class.getConstructor(String.class,String.class,String.class).newInstance(url,USER,PASSWORD);}
        catch(NoSuchMethodException missing){return WebDavTransport.class.getConstructor().newInstance();}
    }
    static List<Core.Op> exchange(WebDavTransport transport,List<Core.Op> operations)throws Exception{
        try{return transport.exchange(operations);}catch(UnsupportedOperationException missing){throw new AssertionError("WebDAV must exchange a validated snapshot",missing);}
    }
    static void failure(Checked action,String fragment)throws Exception{
        try{action.run();throw new AssertionError("Expected failure");}catch(IOException|IllegalArgumentException expected){String message=expected.getMessage();truth(message!=null&&message.contains(fragment));truth(!message.contains(PASSWORD));truth(!message.contains(USER));truth(!message.contains("127.0.0.1"));}
    }
    static void send(HttpExchange request,int code,String body,String etag)throws Exception{
        if(etag!=null)request.getResponseHeaders().set("ETag",etag);
        byte[] bytes=(body==null?"":body).getBytes(StandardCharsets.UTF_8);request.sendResponseHeaders(code,code==204?-1:bytes.length);try(OutputStream output=request.getResponseBody()){output.write(bytes);}
    }
    static String body(HttpExchange request)throws Exception{return new String(request.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);}
    static final class Fixture implements AutoCloseable {
        final HttpServer server;String snapshot;String etag="\"one\"";int gets,puts;Handler override;boolean anonymous;
        Fixture(List<Core.Op> operations)throws Exception{snapshot=operations==null?null:JsonCodec.encode(operations);server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.createContext("/calendar.json",request->{try{if(override!=null){override.handle(request);return;}normal(request);}catch(Throwable error){if(!(error instanceof IOException))error.printStackTrace();try{send(request,500,"fixture error",null);}catch(Exception ignored){}}finally{request.close();}});server.start();}
        String url(){return "http://127.0.0.1:"+server.getAddress().getPort()+"/calendar.json";}
        void normal(HttpExchange request)throws Exception{
            String auth=anonymous?null:"Basic "+Base64.getEncoder().encodeToString((USER+":"+PASSWORD).getBytes(StandardCharsets.UTF_8));truth(Objects.equals(auth,request.getRequestHeaders().getFirst("Authorization")));
            if(request.getRequestMethod().equals("GET")){gets++;send(request,snapshot==null?404:200,snapshot,etag);return;}
            truth(request.getRequestMethod().equals("PUT"));puts++;
            if(snapshot==null)truth("*".equals(request.getRequestHeaders().getFirst("If-None-Match")));else truth(etag.equals(request.getRequestHeaders().getFirst("If-Match")));
            snapshot=body(request);JsonCodec.decode(snapshot);etag="\"written-"+puts+"\"";send(request,201,"",etag);
        }
        public void close(){server.stop(0);}
    }
    public static void main(String[] args)throws Exception{
        Core.Op a=op("local"),b=op("remote"),c=op("race");
        check("404 creates with If-None-Match and confirms by GET",()->{try(Fixture f=new Fixture(null)){List<Core.Op> result=exchange(transport(f.url()),List.of(a));truth(result.size()==1&&result.get(0).equals(a));truth(f.gets==2&&f.puts==1);}});
        check("existing strong ETag uses If-Match and merges both histories",()->{try(Fixture f=new Fixture(List.of(b))){List<Core.Op> result=exchange(transport(f.url()),List.of(a));truth(result.size()==2&&JsonCodec.decode(f.snapshot).size()==2);truth(f.gets==2&&f.puts==1);}});
        check("Jianguoyun bare ETag is preserved verbatim in If-Match",()->{try(Fixture f=new Fixture(List.of(b))){f.etag="c3expXAHSVpSwevAnmJDJA";List<Core.Op> result=exchange(transport(f.url()),List.of(a));truth(result.size()==2&&JsonCodec.decode(f.snapshot).size()==2);truth(f.gets==2&&f.puts==1);}});
        check("bare ETag 412 refetches and preserves every previously merged operation",()->{try(Fixture f=new Fixture(List.of(b))){f.etag="c3expXAHSVpSwevAnmJDJA";AtomicInteger writes=new AtomicInteger();f.override=request->{if(request.getRequestMethod().equals("PUT")&&writes.getAndIncrement()==0){truth(f.etag.equals(request.getRequestHeaders().getFirst("If-Match")));truth(JsonCodec.decode(body(request)).size()==2);f.snapshot=JsonCodec.encode(List.of(c));f.etag="raceETag_2";send(request,412,"",null);}else f.normal(request);};truth(exchange(transport(f.url()),List.of(a)).size()==3);truth(JsonCodec.decode(f.snapshot).size()==3);truth(f.gets==3&&writes.get()==2);}});
        check("read-only WebDAV connection test accepts bare ETag without PUT",()->{try(Fixture f=new Fixture(List.of(b))){f.etag="c3expXAHSVpSwevAnmJDJA";truth(transport(f.url()).testConnection());truth(f.gets==1&&f.puts==0);}});
        check("ETag compatibility accepts bounded tokens and rejects unsafe header values",()->{for(String etag:List.of("\"one\"","\"\"","c3expXAHSVpSwevAnmJDJA","A0._~+/:=-","x","x".repeat(1024)))truth(WebDavTransport.usableEtag(etag));truth(!WebDavTransport.usableEtag(null));for(String etag:List.of("","*","W/\"weak\"","w/\"weak\"","W/weak","w/weak","tag,other","\"one\", \"two\"","tag other"," tag","tag ","tag\tother","tag\r\nInjected: yes","tag\u0000","tag\u007f","tag\\other","\"unfinished","unfinished\"","汉字","x".repeat(1025)))truth(!WebDavTransport.usableEtag(etag));});
        check("invalid bare ETags prevent PUT",()->{for(String etag:List.of("*","W/weak","w/weak","tag,other","\"tag\",\"other\"","tag other","tag\\other","\"unfinished","unfinished\"","!unsupported","tag@unsupported","x".repeat(1025))){try(Fixture f=new Fixture(List.of(b))){f.etag=etag;failure(()->exchange(transport(f.url()),List.of(a)),"ETag");truth(f.puts==0);}}});
        check("412 refetches and remerges a concurrent remote operation",()->{try(Fixture f=new Fixture(List.of(b))){AtomicInteger writes=new AtomicInteger();f.override=request->{if(request.getRequestMethod().equals("PUT")&&writes.getAndIncrement()==0){f.snapshot=JsonCodec.encode(List.of(b,c));f.etag="\"race\"";send(request,412,"",null);}else f.normal(request);};truth(exchange(transport(f.url()),List.of(a)).size()==3);truth(JsonCodec.decode(f.snapshot).size()==3);truth(f.gets==3);}});
        check("412 retries are bounded at five conditional writes",()->{try(Fixture f=new Fixture(List.of(b))){AtomicInteger writes=new AtomicInteger();f.override=request->{if(request.getRequestMethod().equals("PUT")){writes.incrementAndGet();send(request,412,"",null);}else f.normal(request);};failure(()->exchange(transport(f.url()),List.of(a)),"频繁");truth(writes.get()==5);}});
        check("weak ETag prevents PUT",()->{try(Fixture f=new Fixture(List.of(b))){f.etag="W/\"weak\"";failure(()->exchange(transport(f.url()),List.of(a)),"ETag");truth(f.puts==0);}});
        check("missing ETag prevents PUT",()->{try(Fixture f=new Fixture(List.of(b))){f.etag=null;failure(()->exchange(transport(f.url()),List.of(a)),"ETag");truth(f.puts==0);}});
        check("malformed snapshot never gets overwritten",()->{try(Fixture f=new Fixture(List.of(b))){f.snapshot="<html>login</html>";failure(()->exchange(transport(f.url()),List.of(a)),"数据格式");truth(f.puts==0);}});
        check("unknown snapshot fields are rejected before PUT",()->{try(Fixture f=new Fixture(List.of(b))){f.snapshot=f.snapshot.replace("\"schemaVersion\":1","\"schemaVersion\":1,\"password\":\"private\"");failure(()->exchange(transport(f.url()),List.of(a)),"数据格式");truth(f.puts==0);}});
        check("operation ID content collision prevents PUT",()->{try(Fixture f=new Fixture(List.of(a))){Core.Task changed=a.task.copy();changed.title="different";Core.Op collision=new Core.Op(a.id,changed,a.parents,a.deviceId,a.createdAt);failure(()->exchange(transport(f.url()),List.of(collision)),"冲突");truth(f.puts==0);}});
        check("response over ten MiB is rejected before PUT",()->{try(Fixture f=new Fixture(List.of(b))){f.snapshot=" ".repeat(10*1024*1024+1);failure(()->exchange(transport(f.url()),List.of(a)),"10 MB");truth(f.puts==0);}});
        check("redirect is rejected and credentials never follow Location",()->{try(Fixture target=new Fixture(null);Fixture f=new Fixture(null)){f.override=request->{request.getResponseHeaders().set("Location",target.url());send(request,302,"",null);};failure(()->exchange(transport(f.url()),List.of(a)),"重定向");truth(target.gets==0&&target.puts==0);}});
        check("PUT success without confirming all contents does not acknowledge",()->{try(Fixture f=new Fixture(List.of(b))){f.override=request->{if(request.getRequestMethod().equals("PUT")){body(request);f.puts++;send(request,204,"",null);}else f.normal(request);};failure(()->exchange(transport(f.url()),List.of(a)),"确认");truth(f.puts==1&&f.gets==2);}});
        check("bare ETag write without complete readback does not acknowledge",()->{try(Fixture f=new Fixture(List.of(b))){f.etag="c3expXAHSVpSwevAnmJDJA";f.override=request->{if(request.getRequestMethod().equals("PUT")){truth(f.etag.equals(request.getRequestHeaders().getFirst("If-Match")));body(request);f.puts++;send(request,204,"",null);}else f.normal(request);};failure(()->exchange(transport(f.url()),List.of(a)),"确认");truth(f.puts==1&&f.gets==2);}});
        check("missing parent collection gives an actionable 409",()->{try(Fixture f=new Fixture(null)){f.override=request->{if(request.getRequestMethod().equals("PUT"))send(request,409,"server supplied secret",null);else f.normal(request);};failure(()->exchange(transport(f.url()),List.of(a)),"文件夹");}});
        check("authentication errors reveal no remote response or credentials",()->{try(Fixture f=new Fixture(null)){f.override=request->send(request,401,PASSWORD,null);failure(()->exchange(transport(f.url()),List.of(a)),"401");}});
        check("URL rejects userinfo, query, fragment and folder-only paths",()->{for(String url:List.of("https://user:secret@example.com/calendar.json","https://example.com/calendar.json?token=x","https://example.com/calendar.json#x","https://example.com/","file:///calendar.json")){try{transport(url);throw new AssertionError("Expected URL rejection");}catch(java.lang.reflect.InvocationTargetException expected){truth(expected.getCause() instanceof IllegalArgumentException);}}});
        check("computer connection test validates authenticated GET without uploading",()->{HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);AtomicInteger gets=new AtomicInteger();server.createContext("/api/sync",request->{try{truth(request.getRequestMethod().equals("GET"));truth("Bearer test-token".equals(request.getRequestHeaders().getFirst("Authorization")));gets.incrementAndGet();send(request,200,JsonCodec.encode(List.of(b)),null);}catch(Exception failure){throw new RuntimeException(failure);}finally{request.close();}});server.start();try{HttpSyncTransport transport=new HttpSyncTransport("http://127.0.0.1:"+server.getAddress().getPort(),"test-token");try{HttpSyncTransport.class.getMethod("testConnection").invoke(transport);}catch(NoSuchMethodException missing){throw new AssertionError("Computer connection test must use read-only GET");}truth(gets.get()==1);}finally{server.stop(0);}});
        check("anonymous DAV omits authorization and still confirms conditional creation",()->{try(Fixture f=new Fixture(null)){f.anonymous=true;truth(exchange(new WebDavTransport(f.url(),"",""),List.of(a)).size()==1);truth(f.gets==2&&f.puts==1);}});
        check("encoded traversal separators and double encoded traversal are rejected",()->{for(String path:List.of("/../calendar.json","/%2e%2e/calendar.json","/%252e%252e/calendar.json","/folder%2fescape/calendar.json","/folder%5cescape/calendar.json"))failure(()->new WebDavTransport("https://example.com"+path,USER,PASSWORD),"完整");});
        check("trailing garbage after a snapshot never gets overwritten",()->{try(Fixture f=new Fixture(List.of(b))){f.snapshot+=" trailing-secret";failure(()->exchange(transport(f.url()),List.of(a)),"数据格式");truth(f.puts==0);}});
        System.out.println("WebDAV host tests passed: "+passed);
    }
}
