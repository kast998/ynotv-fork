# Applies ynoTV changes on top of a FongMi/TV checkout (cwd = checkout root).
import re, sys
def edit(path, old, new, count=1):
    s = open(path, encoding='utf-8').read()
    if old not in s:
        sys.exit(f'patch failed: {path}: {old[:60]!r}')
    s = s.replace(old, new, count)
    open(path, 'w', encoding='utf-8').write(s)

J = 'app/src/main/java/com/fongmi/android/tv/'
# 1. BaseLoader: built-in YouTube spider
edit(J + 'api/loader/BaseLoader.java',
     '    public Spider getSpider(String key, String api, String ext, String jar) {\n        if (isNode(api)) {',
     '    private final java.util.Map<String, Spider> builtins = new java.util.concurrent.ConcurrentHashMap<>();\n\n'
     '    public Spider getSpider(String key, String api, String ext, String jar) {\n'
     '        if (com.fongmi.android.tv.api.spider.YouTubeSpider.isApi(api)) {\n'
     '            return builtins.computeIfAbsent(key, k -> {\n'
     '                Spider s = new com.fongmi.android.tv.api.spider.YouTubeSpider();\n'
     '                s.siteKey = k;\n'
     '                try { s.init(com.fongmi.android.tv.App.get(), ext); } catch (Exception e) { e.printStackTrace(); }\n'
     '                return s;\n'
     '            });\n'
     '        }\n'
     '        if (isNode(api)) {')
# 2. VodConfig: append YouTube site to every config
edit(J + 'api/config/VodConfig.java',
     '        Map<String, Site> items = Site.findAll()',
     '        if (getSites().stream().noneMatch(s -> com.fongmi.android.tv.api.spider.YouTubeSpider.KEY.equals(s.getKey()))) getSites().add(com.fongmi.android.tv.api.spider.YouTubeSpider.site());\n'
     '        Map<String, Site> items = Site.findAll()')
# 3. app id / name / version
edit('app/build.gradle', 'applicationId "com.fongmi.android.tv"', 'applicationId "com.ynotv.android"')
edit(J + 'utils/Github.java', 'REPO = "FongMi/Release"', 'REPO = "kast998/ynotv-fork"')
for p, name in [('app/src/main/res/values/strings.xml', 'TV'), ('app/src/main/res/values-zh-rCN/strings.xml', '影视'), ('app/src/main/res/values-zh-rTW/strings.xml', '影視')]:
    edit(p, f'<string name="app_name">{name}</string>', '<string name="app_name">ynoTV</string>')
print('patched')
