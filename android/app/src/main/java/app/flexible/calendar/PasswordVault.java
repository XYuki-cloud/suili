package app.flexible.calendar;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Base64;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Only the ciphertext enters private settings. The AES key remains in Android Keystore. */
final class PasswordVault {
    private static final String ALIAS="suili.webdav.password.v1";
    private static final byte[] AAD="app.flexible.calendar.webdav.v1".getBytes(StandardCharsets.UTF_8);
    private static synchronized javax.crypto.SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return (javax.crypto.SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    static String encrypt(String password) throws IOException {
        try{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());cipher.updateAAD(AAD);return Base64.getEncoder().encodeToString(cipher.getIV())+"."+Base64.getEncoder().encodeToString(cipher.doFinal(password.getBytes(StandardCharsets.UTF_8)));}
        catch(Exception failure){throw new IOException("无法使用 Android 安全存储保存密码，原配置已保留");}
    }
    static String decrypt(String encrypted) throws IOException {
        if(encrypted==null||encrypted.isEmpty())return "";
        try{String[] parts=encrypted.split("\\.",-1);if(parts.length!=2)throw new IllegalArgumentException();byte[] iv=Base64.getDecoder().decode(parts[0]);if(iv.length!=12)throw new IllegalArgumentException();Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));cipher.updateAAD(AAD);return new String(cipher.doFinal(Base64.getDecoder().decode(parts[1])),StandardCharsets.UTF_8);}
        catch(Exception failure){throw new IOException("无法读取已保存的 WebDAV 密码，请重新输入并保存；事项数据仍保留");}
    }
}
