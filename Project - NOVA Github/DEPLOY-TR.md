# PROJECT NOVA — Yayına alma rehberi (sıfırdan)

Bu rehber hiçbir şeyiniz hazır değilken sizi yayına götürür. Toplam süre yaklaşık 30–45 dakika.

## 0) Neye ihtiyacınız var
| Ne | Nereden | Yaklaşık maliyet |
|---|---|---|
| Alan adı (ör. `ornek.com`) | Cloudflare Registrar, Namecheap, GoDaddy veya Türkiye'deki bir kayıt firması | yılda 10–20 USD |
| Sanal sunucu (VPS), Ubuntu 24.04 | Hetzner, DigitalOcean, Contabo vb. (en küçük paket yeter: 1–2 GB RAM) | ayda ~4–6 EUR |

Bu paket bir **sunucuda çalışan uygulama**dır. Yönetim paneli, giriş, veritabanı ve ziyaretçi analitiği bu yüzden
yalnızca kendi sunucunuzda çalışır; claude.ai'daki paylaşım bağlantısında çalışmaz.

## 1) Alan adını sunucuya yönlendirin
Sunucuyu oluşturunca bir **IP adresi** verilir. Alan adınızın DNS ayarlarında iki kayıt ekleyin:
- `A` kaydı: ad `@` → sunucu IP'si
- `A` kaydı: ad `www` → sunucu IP'si

Yayılması birkaç dakika ile birkaç saat sürebilir. (Cloudflare kullanıyorsanız bulut simgesini başta **gri / DNS only** bırakın.)

## 2) Sunucuya bağlanıp Docker kurun
Bilgisayarınızdaki terminalden (Windows'ta PowerShell):
```bash
ssh root@SUNUCU_IP
curl -fsSL https://get.docker.com | sh
apt-get install -y unzip ufw
ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 3) Dosyaları yükleyin
Yeni bir terminal penceresinde (kendi bilgisayarınızda, zip'in olduğu klasörde):
```bash
scp project-nova-command-center.zip root@SUNUCU_IP:/root/
```
Sunucuda:
```bash
cd /root && unzip project-nova-command-center.zip && cd project-nova
cp .env.example .env
nano .env        # DOMAIN=ornek.com   ve   SETUP_TOKEN=... (rastgele uzun bir metin) yazın, Ctrl+O, Enter, Ctrl+X
```
Rastgele anahtar üretmek için: `openssl rand -hex 16`

## 4) Başlatın
```bash
docker compose up -d --build
docker compose logs -f app      # "FIRST RUN" satırını görürseniz hazırdır (Ctrl+C ile çıkın)
```
HTTPS sertifikası otomatik alınır (Caddy / Let's Encrypt). Alan adı sunucuya yönlenmediyse sertifika alınamaz; 1. adımı ve
80/443 portlarını kontrol edin.

## 5) İlk yönetici hesabı
`https://ornek.com/admin/` adresini açın → **İLK KURULUM** ekranı gelir:
`SETUP_TOKEN` değerini, istediğiniz kullanıcı adını ve en az 12 karakterlik bir parolayı girin. Anahtar tek kullanımlıktır; hesap
oluşunca kurulum ekranı kendini kapatır. Parolayı bir parola yöneticisine kaydedin.

## 6) İçeriği düzenleyin
- **İçerik**: Site/Hakkında, Projeler, Yetenekler, Deneyim. Alanlar sitenin mevcut içeriğiyle dolu gelir. Taslak kendiliğinden
  kaydedilir; **Önizle** ile yayınlanmamış hâli görürsünüz; **YAYINLA** ile canlıya çıkar; **Geçmiş** ile eski sürümlere dönersiniz.
- **Medya**: görsel yükleyin (PNG/JPG/WEBP), alt metin yazın, projelerde kapak görseli olarak seçin.
- Başlangıçta yer tutucu olan bilgiler (biyografi, e-posta, GitHub/LinkedIn/CV bağlantıları, projeler) **sizin girmeniz gereken**
  alanlardır; hiçbiri uydurulmadı.

## 6b) Yönetim panelinde neler var
Genel Bakış (uyarılar dahil) · Analitik (huni, tıklama haritası, çıkış noktaları) · İçerik (Site, Projeler, Yetenekler, Deneyim, **Tema & 3D**, **SEO**) ·
Medya · Kullanıcılar · Ayarlar (saklama süresi, yedek, dışa aktarma) · Denetim · Güvenlik (parola, oturumlar, **iki adımlı doğrulama**).
Ürün yayına çıkarken: SEO sekmesinde "İndeksle" seçili olsun ve `.env` içindeki `DOMAIN` doğru olsun (sitemap.xml / robots.txt buna göre üretilir).
**İlk işiniz:** Güvenlik sayfasından 2FA'yı açıp kurtarma kodlarını kaydedin.

## 7) Yedekleme (önemli)
Panelde **Ayarlar → Şimdi yedek al** düğmesi var; otomatik günlük yedek için aşağıdaki cron satırı yine önerilir.
Her şey `nova-data` Docker birimindedir. Günlük otomatik yedek için sunucuda `crontab -e` ile ekleyin:
```
0 3 * * * cd /root/project-nova && docker compose exec -T app node scripts/backup.js
```
Yedekler birimin içindeki `backups/` klasörüne yazılır (son 14 tanesi tutulur). **Yedekleri sunucunun dışına da kopyalayın**
(ör. `docker compose cp app:/data/backups ./yedekler` ardından kendi bilgisayarınıza `scp`). Sunucu bozulursa kopyasız veri kaybolur.

Geri yükleme: yedek klasöründeki `nova.db` ve `media/` dosyalarını yeni sunucuda `/data` içine koyup `docker compose restart app`.

## 8) Güncelleme
Yeni sürümün zip'ini aynı şekilde yükleyip açın (`.env` dosyanız ve veriniz korunur), sonra `docker compose up -d --build`.

## 9) Sık sorunlar
- **Site açılmıyor / sertifika hatası:** DNS yayılmamış olabilir; `docker compose logs caddy` bakın; 80 ve 443 açık mı?
- **Parolamı unuttum:** `docker compose exec app node scripts/reset-password.js kullaniciadi`
- **Çok fazla yanlış giriş:** 15 dakika bekleyin (kaba kuvvet koruması).

## 10) Gizlilik (KVKK / GDPR) — hukuki tavsiye değildir
Analitik yalnızca ziyaretçi **izin verirse** çalışır; çerez kullanmaz, IP adresi saklamaz, 90 gün sonra siler. Yine de sitenize
bir gizlilik/aydınlatma metni eklemeniz ve gerekirse bir hukukçuya danışmanız önerilir. Analitiği tamamen kapatmak için
`public/index.html` içindeki `nova-track.js` satırını silin.

## Yeni: e-posta bildirimi (isteğe bağlı)

İletişim formundan mesaj geldiğinde ya da biri yıldız bıraktığında e-posta almak için Hostinger → Node.js uygulaması → **Ortam değişkenleri** bölümüne şunları ekleyin ve yeniden dağıtın (Hostinger e-posta hesabınızla çalışır):

| Değişken | Örnek |
|---|---|
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `bildirim@cagrisametulusoy.com` |
| `SMTP_PASS` | (o e-posta hesabının parolası — sadece panele yazın, kimseyle paylaşmayın) |
| `NOTIFY_TO` | bildirimlerin gideceği adres |

Ayarlanmazsa site normal çalışır; mesajlar yine yönetim panelindeki **Mesajlar** sekmesine düşer.

## Yeni: kütüphanelerin kendi sunucunuzdan yüklenmesi

`build` adımı (scripts/check-node.js) artık Three.js ve GSAP'ı `public/assets/vendor/` klasörüne indirmeyi dener. İnebilirse site bu kopyaları kullanır (daha hızlı açılış); inemezse hiçbir şey bozulmaz, site cdnjs'ten yüklemeye devam eder.
