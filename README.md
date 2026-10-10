# Feed – iOS uygulaması (Capacitor)

Yerelde test (Windows): `cd www` → `python -m http.server 8080` → http://localhost:8080
(Tarayıcıda CORS engellerse: `chrome.exe --disable-web-security --user-data-dir=C:\tmp\chrome-dev` ile aç; yalnızca test içindir.)

IPA üretimi: GitHub'a özel (private) repo olarak yükle → Actions → "Build iOS IPA" → Run workflow →
bitince Artifacts > Feed-ipa indir → Sideloadly ile iPhone'a kur.
