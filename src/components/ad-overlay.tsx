import { useEffect, useMemo, useState } from "react";
import { ADS, ADS_PAUSED_UNTIL, type Ad, type GalleryAd, type PromoAd } from "@/lib/ads";

type Scene = { id: string; stay: number };

function scenesFor(ad: Ad): Scene[] {
  if (ad.type === "gallery") {
    const s: Scene[] = ad.photos.map((_, i) => ({ id: `photo-${i}`, stay: 2100 }));
    s.push({ id: "final", stay: 1600 });
    return s;
  }
  return [
    { id: "logo", stay: 1700 },
    { id: "services", stay: 2500 },
    { id: "tagline", stay: 2200 },
    { id: "contact", stay: 0 },
  ];
}

/**
 * Ventana flotante con un anuncio elegido al azar. Bloquea la herramienta
 * mientras corre; al final hay una cuenta regresiva de 3 s y recién entonces
 * se puede cerrar. Si no hay anuncios, o están en pausa, no muestra nada.
 */
export function AdOverlay() {
  const [ad, setAd] = useState<Ad | null>(null);
  const [scene, setScene] = useState(0);
  const [count, setCount] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(false);

  // elegir al azar solo en el navegador (evita diferencias con el render del servidor)
  useEffect(() => {
    if (Date.now() < ADS_PAUSED_UNTIL) return;
    const pool = ADS.filter((a) => a.logo && a.tagline);
    if (!pool.length) return;
    setAd(pool[Math.floor(Math.random() * pool.length)]);
    setOpen(true);
  }, []);

  const scenes = useMemo(() => (ad ? scenesFor(ad) : []), [ad]);
  const total = scenes.reduce((a, s) => a + s.stay, 0);
  const captions = useMemo(
    () =>
      ad?.type === "gallery"
        ? ad.photos.map((p) => p.captions[Math.floor(Math.random() * p.captions.length)] ?? { title: "", body: "" })
        : [],
    [ad],
  );

  useEffect(() => {
    if (!ad || !scenes.length) return;
    document.body.style.overflow = "hidden";
    const timers: number[] = [];
    requestAnimationFrame(() => setProgress(true));
    let elapsed = 0;
    for (let i = 0; i < scenes.length - 1; i++) {
      elapsed += scenes[i].stay;
      timers.push(window.setTimeout(() => setScene(i + 1), elapsed));
    }
    elapsed += scenes[scenes.length - 1].stay;
    timers.push(
      window.setTimeout(() => {
        setCount(3);
        let n = 3;
        const tick = window.setInterval(() => {
          n -= 1;
          setCount(n);
          if (n <= 0) window.clearInterval(tick);
        }, 1000);
        timers.push(tick);
      }, elapsed),
    );
    return () => {
      timers.forEach((t) => {
        window.clearTimeout(t);
        window.clearInterval(t);
      });
      document.body.style.overflow = "";
    };
  }, [ad, scenes]);

  if (!ad || !open) return null;
  const closable = count === 0;
  const close = () => {
    if (!closable) return;
    setClosing(true);
    document.body.style.overflow = "";
    window.setTimeout(() => setOpen(false), 350);
  };
  const active = scenes[scene]?.id;

  return (
    <div
      className={`fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm transition-opacity duration-300 ${closing ? "opacity-0" : "opacity-100"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Anuncio"
    >
      <div
        className={`relative w-full overflow-hidden rounded-2xl border border-line bg-white text-slate-900 shadow-2xl ${ad.type === "gallery" ? "max-w-md" : "max-w-sm"}`}
      >
        <div className="absolute inset-x-0 top-0 z-20 h-1 bg-slate-200">
          <div
            className="h-full bg-call transition-[width] ease-linear"
            style={{ width: progress ? "100%" : "0%", transitionDuration: `${total}ms` }}
          />
        </div>
        {count != null ? (
          <button
            type="button"
            onClick={close}
            aria-label={closable ? "Cerrar anuncio" : `Se puede cerrar en ${count}`}
            className={`absolute top-3 right-3 z-30 grid size-10 place-items-center rounded-full text-sm font-semibold shadow ${closable ? "bg-slate-900 text-white" : "bg-white/90 text-slate-600"}`}
          >
            {closable ? "✕" : count}
          </button>
        ) : null}
        <div className="relative h-[460px] sm:h-[520px]">
          {ad.type === "gallery" ? (
            <GalleryScenes ad={ad} active={active} sceneIndex={scene} captions={captions} />
          ) : (
            <PromoScenes ad={ad} active={active} />
          )}
        </div>
      </div>
    </div>
  );
}

function SceneBox({ on, children, className = "" }: { on: boolean; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center transition-all duration-700 ${on ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"} ${className}`}
    >
      {children}
    </div>
  );
}

function PromoScenes({ ad, active }: { ad: PromoAd; active?: string }) {
  const c = ad.contact;
  return (
    <>
      <SceneBox on={active === "logo"}>
        <img src={ad.logo} alt={ad.logoAlt} className="max-h-48 w-auto max-w-[80%] object-contain" />
      </SceneBox>
      <SceneBox on={active === "services"}>
        <div className="grid w-full gap-3">
          {ad.services.map((s) => (
            <div key={s.label} className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-3 text-lg font-semibold">
              <span className="text-2xl" aria-hidden="true">{s.icon}</span>
              {s.label}
            </div>
          ))}
        </div>
      </SceneBox>
      <SceneBox on={active === "tagline"}>
        <p className="text-3xl font-bold tracking-tight">{ad.tagline}</p>
        {ad.subtagline ? <p className="text-lg text-slate-600">{ad.subtagline}</p> : null}
      </SceneBox>
      <SceneBox on={active === "contact"}>
        <img src={ad.logo} alt={ad.logoAlt} className="max-h-24 w-auto object-contain" />
        {c.note ? <p className="text-sm text-slate-600">{c.note}</p> : null}
        {c.phone ? <p className="text-xl font-semibold">{c.phone}</p> : null}
        <div className="grid w-full gap-2">
          {c.site ? <AdButton href={c.site} label={`🌐 ${c.siteLabel ?? "Visitar sitio"}`} tone="bg-slate-900" external /> : null}
          {c.whatsappUrl ? <AdButton href={c.whatsappUrl} label="💬 WhatsApp" tone="bg-emerald-600" external /> : null}
          {c.callUrl ? <AdButton href={c.callUrl} label="📞 Llamar" tone="bg-sky-700" /> : null}
        </div>
      </SceneBox>
    </>
  );
}

function GalleryScenes({
  ad,
  active,
  sceneIndex,
  captions,
}: {
  ad: GalleryAd;
  active?: string;
  sceneIndex: number;
  captions: { title: string; body: string }[];
}) {
  return (
    <>
      <div className="absolute inset-0 grid grid-cols-3 gap-1 bg-rose-50 p-1" aria-hidden="true">
        {ad.photos.map((p, i) => (
          <div
            key={p.src}
            className={`rounded-md bg-cover bg-center transition-opacity duration-700 ${i < sceneIndex ? "opacity-40" : "opacity-0"}`}
            style={{ backgroundImage: `url('${p.src}')` }}
          />
        ))}
      </div>
      {ad.photos.map((p, i) => (
        <SceneBox key={p.src} on={active === `photo-${i}`} className="justify-end p-0">
          <img src={p.src} alt={p.alt} className="absolute inset-0 size-full object-cover" />
          <div className="relative w-full bg-gradient-to-t from-black/80 to-transparent p-5 pt-16 text-left text-white">
            <p className="text-xl font-bold">{captions[i]?.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/90">{captions[i]?.body}</p>
          </div>
        </SceneBox>
      ))}
      <SceneBox on={active === "final"}>
        <div className="flex w-full flex-col items-center gap-3 rounded-2xl bg-white/95 p-6 shadow-lg">
          <img src={ad.logo} alt={ad.logoAlt} className="max-h-32 w-auto object-contain" />
          <p className="text-2xl font-bold">{ad.brand}</p>
          <p className="text-lg text-slate-600">{ad.tagline}</p>
          <div className="grid w-full gap-2">
            {ad.contact.whatsappUrl ? <AdButton href={ad.contact.whatsappUrl} label="💬 WhatsApp" tone="bg-emerald-600" external /> : null}
            {ad.contact.smsUrl ? <AdButton href={ad.contact.smsUrl} label="✉️ Mensaje de texto" tone="bg-sky-700" /> : null}
          </div>
        </div>
      </SceneBox>
    </>
  );
}

function AdButton({ href, label, tone, external }: { href: string; label: string; tone: string; external?: boolean }) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener" : undefined}
      className={`flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold text-white ${tone}`}
    >
      {label}
    </a>
  );
}
