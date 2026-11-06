package app.flexible.calendar;

import java.net.URI;
import java.util.Set;
import java.util.HashSet;
import java.util.Arrays;

/** Deliberately small HTTPS origin. Never maps arbitrary paths to assets or private files. */
final class PlannerAssets {
    static final String HOME="https://appassets.androidplatform.net/";
    private static final Set<String> WEB=new HashSet<>(Arrays.asList("index.html","styles.css","app.mjs","calendar.mjs","local-store.mjs","native-store.mjs","edit-session.mjs","drag-plan.mjs","webdav-client.mjs","launch-target.mjs","task-form.mjs"));
    static String assetPath(String url){
        try{
            URI uri=new URI(url);
            if(!"https".equals(uri.getScheme())||!"appassets.androidplatform.net".equals(uri.getHost())||uri.getPort()!=-1||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null)return null;
            String path=uri.getRawPath();if(path==null)return null;
            if(path.equals("/"))path="/index.html";
            if(path.startsWith("/")&&WEB.contains(path.substring(1)))return "planner/web"+path;
            if(path.equals("/shared/core.mjs")||path.equals("/shared/transports.mjs"))return "planner"+path;
        }catch(Exception ignored){}return null;
    }
    static boolean isMainDocument(String url){return "planner/web/index.html".equals(assetPath(url));}
}
