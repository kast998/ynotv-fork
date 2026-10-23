package host;

import android.app.Application;
import android.content.Context;
import java.io.File;
import java.lang.reflect.Method;
import java.net.URL;
import java.net.URLClassLoader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import org.json.JSONArray;
import org.json.JSONObject;

public class SpiderHost {
    private final URLClassLoader loader;
    private final Application context = new Application();
    private final Map<String, Object> instances = new HashMap<String, Object>();

    public SpiderHost(File file, File file2, List<File> list) throws Exception {
        ArrayList<URL> arrayList = new ArrayList<URL>();
        arrayList.add(file2.toURI().toURL());
        for (File file3 : list) {
            arrayList.add(file3.toURI().toURL());
        }
        this.loader = new URLClassLoader(arrayList.toArray(new URL[0]), SpiderHost.class.getClassLoader());
    }

    private boolean initDone = false;

    /**
     * One instance per (spider class, ext). TVBox configs reuse the same
     * spider with different ext (e.g. several csp_Bili sites with their own
     * json lists), so caching by class alone would serve the wrong site.
     */
    public synchronized Object spider(String string, String string2) throws Exception {
        String ext = string2 == null ? "" : string2;
        String cacheKey = string + "\u0000" + ext;
        Object object = this.instances.get(cacheKey);
        if (object == null) {
            Method method;
            Class<?> clazz;
            if (!this.initDone) {
                this.initDone = true;
                try {
                    clazz = Class.forName("com.github.catvod.spider.Init", true, this.loader);
                    method = clazz.getMethod("init", Context.class);
                    method.invoke(null, this.context);
                }
                catch (ClassNotFoundException | NoSuchMethodException reflectiveOperationException) {
                    // no Init class in this jar
                }
            }
            clazz = Class.forName(string, true, this.loader);
            object = clazz.getDeclaredConstructor(new Class[0]).newInstance(new Object[0]);
            try {
                method = clazz.getMethod("init", Context.class, String.class);
                method.invoke(object, this.context, ext);
            }
            catch (NoSuchMethodException noSuchMethodException) {
                clazz.getMethod("init", Context.class).invoke(object, this.context);
            }
            this.instances.put(cacheKey, object);
        }
        return object;
    }

    private static Object toArg(Object object, Class<?> clazz) {
        if (clazz == Boolean.TYPE || clazz == Boolean.class) {
            return Boolean.parseBoolean(String.valueOf(object));
        }
        if (clazz == String.class) {
            return object == null ? null : String.valueOf(object);
        }
        if (clazz == List.class) {
            ArrayList<String> arrayList = new ArrayList<String>();
            if (object instanceof JSONArray) {
                JSONArray jSONArray = (JSONArray)object;
                for (int i = 0; i < jSONArray.length(); ++i) {
                    arrayList.add(String.valueOf(jSONArray.get(i)));
                }
            } else if (object instanceof List) {
                for (Object e : (List)object) {
                    arrayList.add(String.valueOf(e));
                }
            }
            return arrayList;
        }
        if (clazz == HashMap.class || clazz == Map.class) {
            HashMap<String, String> hashMap = new HashMap<String, String>();
            if (object instanceof JSONObject) {
                JSONObject jSONObject = (JSONObject)object;
                for (String string : jSONObject.keySet()) {
                    hashMap.put(string, String.valueOf(jSONObject.get(string)));
                }
            } else if (object instanceof Map) {
                for (Map.Entry<?, ?> entry : ((Map<?, ?>)object).entrySet()) {
                    hashMap.put(String.valueOf(entry.getKey()), String.valueOf(entry.getValue()));
                }
            }
            return hashMap;
        }
        return object;
    }

    public String invoke(String string, String string2, JSONArray jSONArray, String string3) throws Exception {
        Object object = this.spider(string, string3);
        Class<?> clazz = object.getClass();
        Method method;
        Object[] args;
        switch (string2) {
            case "homeContent":
                method = clazz.getMethod("homeContent", Boolean.TYPE);
                args = new Object[]{toArg(jSONArray.opt(0), Boolean.TYPE)};
                break;
            case "homeVideoContent":
                method = clazz.getMethod("homeVideoContent");
                args = new Object[]{};
                break;
            case "categoryContent":
                method = clazz.getMethod("categoryContent", String.class, String.class, Boolean.TYPE, HashMap.class);
                args = new Object[]{toArg(jSONArray.opt(0), String.class), toArg(jSONArray.opt(1), String.class), toArg(jSONArray.opt(2), Boolean.TYPE), toArg(jSONArray.opt(3), HashMap.class)};
                break;
            case "detailContent":
                method = clazz.getMethod("detailContent", List.class);
                args = new Object[]{toArg(jSONArray.opt(0), List.class)};
                break;
            case "searchContent":
                try {
                    method = clazz.getMethod("searchContent", String.class, Boolean.TYPE, String.class);
                    Object pg = jSONArray.opt(2);
                    args = new Object[]{toArg(jSONArray.opt(0), String.class), toArg(jSONArray.opt(1), Boolean.TYPE), pg == null ? "1" : String.valueOf(pg)};
                } catch (NoSuchMethodException e) {
                    method = clazz.getMethod("searchContent", String.class, Boolean.TYPE);
                    args = new Object[]{toArg(jSONArray.opt(0), String.class), toArg(jSONArray.opt(1), Boolean.TYPE)};
                }
                break;
            case "playerContent":
                method = clazz.getMethod("playerContent", String.class, String.class, List.class);
                args = new Object[]{toArg(jSONArray.opt(0), String.class), toArg(jSONArray.opt(1), String.class), toArg(jSONArray.opt(2), List.class)};
                break;
            default:
                throw new IllegalArgumentException("unknown method: " + string2);
        }
        Object object2 = method.invoke(object, args);
        return object2 == null ? "" : String.valueOf(object2);
    }

    public List<String> spiderNames() throws Exception {
        ArrayList<String> arrayList = new ArrayList<String>();
        try (JarFile jarFile = new JarFile(new File(this.loader.getURLs()[0].toURI()));){
            Enumeration<JarEntry> enumeration = jarFile.entries();
            while (enumeration.hasMoreElements()) {
                String string = enumeration.nextElement().getName();
                if (!string.startsWith("com/github/catvod/spider/") || !string.endsWith(".class") || string.contains("$") || string.contains("/merge/")) continue;
                arrayList.add(string.replace('/', '.').replace(".class", ""));
            }
        }
        Collections.sort(arrayList);
        return arrayList;
    }
}
