package app.flexible.calendar;
public final class PlannerAssetsTest {
    static void truth(boolean value){if(!value)throw new AssertionError("Asset origin policy mismatch");}
    public static void main(String[] args){
        truth("planner/web/index.html".equals(PlannerAssets.assetPath("https://appassets.androidplatform.net/")));
        truth("planner/web/app.mjs".equals(PlannerAssets.assetPath("https://appassets.androidplatform.net/app.mjs")));
        truth("planner/web/launch-target.mjs".equals(PlannerAssets.assetPath("https://appassets.androidplatform.net/launch-target.mjs")));
        truth("planner/web/task-form.mjs".equals(PlannerAssets.assetPath("https://appassets.androidplatform.net/task-form.mjs")));
        truth("planner/shared/core.mjs".equals(PlannerAssets.assetPath("https://appassets.androidplatform.net/shared/core.mjs")));
        String[] blocked={"http://appassets.androidplatform.net/app.mjs","https://evil.example/app.mjs","https://appassets.androidplatform.net.evil/app.mjs","file:///android_asset/index.html","content://app/index.html",String.join("@", "https://user", "appassets.androidplatform.net/app.mjs"),"https://appassets.androidplatform.net:443/app.mjs","https://appassets.androidplatform.net/../operations.json","https://appassets.androidplatform.net/%2e%2e/app.mjs","https://appassets.androidplatform.net/shared/%2e%2e/app.mjs","https://appassets.androidplatform.net/api/setup","https://appassets.androidplatform.net/sw.js","https://appassets.androidplatform.net/app.mjs?x=1","https://appassets.androidplatform.net/nested/app.mjs"};
        for(String url:blocked)truth(PlannerAssets.assetPath(url)==null);
        truth(PlannerAssets.isMainDocument("https://appassets.androidplatform.net/"));
        truth(!PlannerAssets.isMainDocument("https://appassets.androidplatform.net/app.mjs"));
        System.out.println("Planner asset origin policy tests passed: "+(blocked.length+7));
    }
}
