package app.flexible.calendar;

import org.json.*;

/** Immutable native-only destination identity; never passed through the WebView bridge. */
final class SyncConfig {
    static final String LOCAL="local", WEBDAV="webdav";
    final String mode,serverUrl,token,fileUrl,username,passwordCipher,generation;
    final boolean webdavEnabled;
    SyncConfig(String mode,String serverUrl,String token,String fileUrl,String username,String passwordCipher,String generation){this(mode,serverUrl,token,fileUrl,username,passwordCipher,true,generation);}
    SyncConfig(String mode,String serverUrl,String token,String fileUrl,String username,String passwordCipher,boolean enabled,String generation){this.mode=mode;this.serverUrl=serverUrl;this.token=token;this.fileUrl=fileUrl;this.username=username;this.passwordCipher=passwordCipher;this.generation=generation;webdavEnabled=enabled;}
    static SyncConfig read(JSONObject object,String generation){return new SyncConfig(object.optString("mode",LOCAL),object.optString("serverUrl",""),object.optString("token",""),object.optString("webdavUrl",""),object.optString("webdavUsername",""),object.optString("webdavPasswordCipher",""),object.optBoolean("webdavEnabled",true),generation);}
    JSONObject json() throws JSONException{return new JSONObject().put("mode",mode).put("serverUrl",serverUrl).put("token",token).put("webdavUrl",fileUrl).put("webdavUsername",username).put("webdavPasswordCipher",passwordCipher).put("webdavEnabled",webdavEnabled);}
    boolean configured(){return WEBDAV.equals(mode)?webdavEnabled&&!fileUrl.isEmpty()&&(username.isEmpty()==passwordCipher.isEmpty()):LOCAL.equals(mode)&&!serverUrl.isEmpty()&&!token.isEmpty();}
    String password() throws java.io.IOException{return PasswordVault.decrypt(passwordCipher);}
    SyncTransport transport() throws Exception {if(!configured())throw new IllegalArgumentException("请先保存所选同步方式的地址与凭据");return WEBDAV.equals(mode)?new WebDavTransport(fileUrl,username,password()):new HttpSyncTransport(serverUrl,token);}
    boolean sameSettings(SyncConfig other){return mode.equals(other.mode)&&serverUrl.equals(other.serverUrl)&&token.equals(other.token)&&fileUrl.equals(other.fileUrl)&&username.equals(other.username)&&passwordCipher.equals(other.passwordCipher)&&webdavEnabled==other.webdavEnabled;}
}
