"""Build ynotv.json: 饭太硬 TVBox config + built-in YouTube site.

Runs in GitHub Actions on a schedule. Decoding mirrors FongMi/TV's Decoder
(plain JSON, image-embedded base64 after "xxxxxxxx**", and the "2423" AES-CBC form),
and relative ./ ../ paths are made absolute against the final config URL.
"""
import base64, json, os, re, sys, urllib.parse, urllib.request

RAW = "https://raw.githubusercontent.com/kast998/ynotv-fork/main/android/tvbox/"
SOURCES = [
    "http://www.饭太硬.cc/tv/",
    "http://www.饭太硬.com/tv/",
    "http://www.饭太硬.net/tv/",
    "http://饭太硬.top/tv/",
    "http://www.饭太硬.xyz/tv/",
    "http://www.饭太硬.art/tv/",
    "http://fty.xxooo.cf/tv/",
]
YOUTUBE = {
    "key": "ynotv_youtube",
    "name": "▶ YouTube",
    "type": 3,
    "api": RAW + "youtube.js?v=2",
    "searchable": 1,
    "quickSearch": 1,
    "changeable": 0,
    "style": {"type": "rect", "ratio": 1.78},
    "ext": {"hl": "zh-HK", "gl": "HK"},
}
EXTRAS = [
    ("摸鱼", "https://0.wudaozhe.net/tvbox/摸鱼.json"),
    ("AIWEX", "https://9280.kstore.vip/aiwex.json"),
]
HERE = os.path.dirname(os.path.abspath(__file__))


def idna(url):
    p = urllib.parse.urlsplit(url)
    host = p.hostname.encode("idna").decode()
    netloc = host + (f":{p.port}" if p.port else "")
    path = urllib.parse.quote(p.path, safe="/%")
    return urllib.parse.urlunsplit((p.scheme, netloc, path, p.query, p.fragment))


def fetch(url):
    import subprocess
    out = subprocess.run(["curl", "-sSL", "-m", "25", "-A", "okhttp/3.15", "-o", "/tmp/fty.bin", "-w", "%{http_code} %{url_effective}", idna(url)],
                         capture_output=True, text=True)
    code, _, final = out.stdout.strip().partition(" ")
    if out.returncode != 0 or code != "200":
        raise Exception(f"HTTP {code} {out.stderr.strip()[:120]}")
    return final, open("/tmp/fty.bin", "rb").read().decode("utf-8", "replace")


def resolve(base, rel):
    return urllib.parse.urljoin(base, rel)


def fix(url, data):
    def js(m):
        t = m.group(0).replace('"./', '"' + resolve(url, "./")).replace('"../', '"' + resolve(url, "../"))
        return t.replace("./", "__JS1__").replace("../", "__JS2__")
    data = re.sub(r'"(\.|\.\.)/(.?|.+?)\.js\?(.?|.+?)"', js, data)
    if "../" in data: data = data.replace("../", resolve(url, "../"))
    if "./" in data: data = data.replace("./", resolve(url, "./"))
    return data.replace("__JS1__", "./").replace("__JS2__", "../")


def cbc(data):
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    decode = bytes.fromhex(data).decode("utf-8", "replace").lower()
    key = decode[decode.index("$#") + 2:decode.index("#$")].ljust(16, "0")[:16]
    iv = decode[-13:].ljust(16, "0")[:16]
    body = bytes.fromhex(data[data.index("2324") + 4:len(data) - 26])
    d = Cipher(algorithms.AES(key.encode()), modes.CBC(iv.encode())).decryptor()
    out = d.update(body) + d.finalize()
    return out[:-out[-1]].decode("utf-8", "replace")


def decode(url, data):
    s = data.strip()
    if s.startswith("{"):
        return fix(url, s)
    if "**" in s:
        m = re.search(r"[A-Za-z0-9]{8}\*\*", s)
        if m and m.end() < len(s):
            s = base64.b64decode(s[m.end():] + "===").decode("utf-8", "replace")
    if s.startswith("2423"):
        s = cbc(re.sub(r"\s+", "", s))
    return fix(url, s)


def parse(text):
    try:
        return json.loads(text)
    except Exception:
        import json5
        return json5.loads(text)


def load_fty():
    errors = []
    for src in SOURCES:
        try:
            final, raw = fetch(src)
            cfg = parse(decode(final, raw))
            if isinstance(cfg, dict) and cfg.get("sites"):
                print(f"ok {src} -> {final}: {len(cfg['sites'])} sites")
                return cfg
            errors.append(f"{src}: no sites")
        except Exception as e:
            errors.append(f"{src}: {e}")
    print("\n".join(errors))
    return None


def load_extra(label, url):
    try:
        final, raw = fetch(url)
        cfg = parse(decode(final, raw))
    except Exception as e:
        print(f"{label}: {e}")
        return None
    if not isinstance(cfg, dict) or not cfg.get("sites"):
        print(f"{label}: no sites")
        return None
    spider = cfg.get("spider", "")
    sites = []
    for site in cfg["sites"]:
        site = dict(site)
        if spider and not site.get("jar") and site.get("type") == 3 and not str(site.get("api", "")).startswith(("http", "./", "../")) and not str(site.get("api", "")).endswith((".js", ".py")):
            site["jar"] = spider
        site["key"] = f"{label}_{site.get('key', site.get('name', ''))}"
        site["name"] = f"[{label}] {site.get('name', '')}"
        sites.append(site)
    lives = []
    for live in cfg.get("lives", []) or []:
        live = dict(live)
        live["name"] = f"[{label}] {live.get('name', '')}"
        lives.append(live)
    print(f"ok {label} -> {final}: {len(sites)} sites, {len(lives)} lives")
    return sites, lives


def write(name, cfg):
    with open(os.path.join(HERE, name), "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=1)


def main():
    write("youtube.json", {"sites": [YOUTUBE]})
    cfg = load_fty()
    if cfg is None:
        try:
            cfg = json.load(open(os.path.join(HERE, "ynotv.json"), encoding="utf-8"))
            labels = tuple(f"{label}_" for label, _ in EXTRAS)
            tags = tuple(f"[{label}]" for label, _ in EXTRAS)
            cfg["sites"] = [x for x in cfg.get("sites", []) if not str(x.get("key", "")).startswith(labels)]
            cfg["lives"] = [x for x in cfg.get("lives", []) if not str(x.get("name", "")).startswith(tags)]
            print("饭太硬 unreachable; reusing previous 饭太硬 part")
        except Exception:
            cfg = {"sites": []}
    sites = [YOUTUBE] + [s for s in cfg["sites"] if s.get("key") != YOUTUBE["key"]]
    lives = list(cfg.get("lives", []) or [])
    old = {}
    try:
        prev = json.load(open(os.path.join(HERE, "ynotv.json"), encoding="utf-8"))
        for label, _ in EXTRAS:
            old[label] = ([x for x in prev.get("sites", []) if str(x.get("key", "")).startswith(label + "_")],
                          [x for x in prev.get("lives", []) if str(x.get("name", "")).startswith(f"[{label}]")])
    except Exception:
        pass
    for label, url in EXTRAS:
        got = load_extra(label, url) or old.get(label)
        if got:
            sites += got[0]
            lives += got[1]
    seen, uniq = set(), []
    for live in lives:
        u = live.get("url") or live.get("api") or live.get("name")
        if u in seen: continue
        seen.add(u); uniq.append(live)
    cfg["sites"] = sites
    cfg["lives"] = uniq
    write("ynotv.json", cfg)


if __name__ == "__main__":
    main()
