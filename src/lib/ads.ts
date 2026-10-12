/**
 * Catálogo de anuncios de la ventana flotante inicial (el mismo de la
 * calculadora de rango). En cada carga se elige uno al azar. Para agregar un
 * anuncio basta con sumar un objeto a ADS; si la lista queda vacía no se
 * muestra nada y la herramienta funciona normal.
 *
 * Formatos: "promo" (logo → servicios → frase → contacto) y "gallery" (fotos
 * a pantalla completa con mensaje, collage de fondo y escena final).
 */
const ORIGIN = "https://precio-optimo-opciones.vercel.app";

export type PromoAd = {
  id: string;
  type?: "promo";
  logo: string;
  logoAlt: string;
  services: { icon: string; label: string }[];
  tagline: string;
  subtagline?: string;
  contact: { note?: string; phone?: string; site?: string; siteLabel?: string; whatsappUrl?: string; callUrl?: string };
};

export type GalleryAd = {
  id: string;
  type: "gallery";
  logo: string;
  logoAlt: string;
  brand: string;
  tagline: string;
  photos: { src: string; alt: string; captions: { title: string; body: string }[] }[];
  contact: { whatsappUrl?: string; smsUrl?: string };
};

export type Ad = PromoAd | GalleryAd;

/** Mientras esta fecha no pase no se muestra publicidad. */
export const ADS_PAUSED_UNTIL = new Date("2026-09-09T11:10:00Z").getTime();

const kb = (n: number) => `${ORIGIN}/karlas-${n}.jpg`;
const pastelMsg = encodeURIComponent("Hola, quiero más información sobre sus pasteles");

export const ADS: Ad[] = [
  {
    id: "all-over-solutions",
    logo: `${ORIGIN}/logo.jpg`,
    logoAlt: "All Over Solutions LLC",
    services: [
      { icon: "🛡️", label: "Seguros" },
      { icon: "🖋️", label: "Notaría" },
      { icon: "📑", label: "Trámites" },
    ],
    tagline: "Todo en un solo lugar.",
    subtagline: "Rápido. Confiable. Sin vueltas.",
    contact: {
      note: "Seguros · Notaría · Trámites — todo en un solo lugar",
      phone: "(409) 433-2770",
      site: "https://alloversolutions-us.com",
      siteLabel: "Visitar sitio",
      whatsappUrl: "https://wa.me/14094332770?text=" + encodeURIComponent("Hola, quiero más información sobre sus servicios"),
      callUrl: "tel:+14094332770",
    },
  },
  {
    id: "karlas-bake",
    type: "gallery",
    logo: `${ORIGIN}/karlas-logo.jpg`,
    logoAlt: "Karla's Bake",
    brand: "Karla's Bake",
    tagline: "Vive la magia",
    photos: [
      {
        src: kb(1),
        alt: "Pastel de cumpleaños celeste con letrero dorado",
        captions: [
          { title: "Con mucho amor", body: "Cada pétalo de crema esconde un pedacito de nuestro cariño, amasado despacio para llegar directo a tus manos." },
          { title: "Hecho para celebrarte", body: "Porque tu día merece algo que se hizo pensando solo en vos, con calma y con ganas de verte sonreír." },
        ],
      },
      {
        src: kb(2),
        alt: "Cheesecake con swirls rosados",
        captions: [
          { title: "El dulce exacto", body: "Buscamos ese punto justo entre lo dulce y lo especial, para que cada bocado se sienta como un abrazo tibio." },
          { title: "Sabores que se recuerdan", body: "No es solo un postre — es esa receta que se prepara pensando en la persona que lo va a disfrutar." },
        ],
      },
      {
        src: kb(3),
        alt: "Pastel rosado de princesa con corona y mariposas",
        captions: [
          { title: "Personalizado, como vos", body: "Cada detalle se piensa para contar tu historia. No hay dos pasteles iguales, porque no hay dos personas iguales." },
          { title: "Para las princesas de la casa", body: "Con la misma ternura con la que se cuida a quien más se ama, así se arma cada capa de este pastel." },
        ],
      },
      {
        src: kb(4),
        alt: "Pastel celeste y blanco con letrero dorado de Happy Birthday",
        captions: [
          { title: "Para alguien especial", body: "Se nota cuando un pastel se hace pensando en una persona en particular. Eso es lo que buscamos siempre." },
          { title: "Con los detalles que importan", body: "Las perlitas, el color justo, el mensaje — todo se elige con la misma dedicación con la que se elige un regalo." },
        ],
      },
      {
        src: kb(5),
        alt: "Pastel en forma de corazón con mensaje escrito a mano",
        captions: [
          { title: "Momentos que se guardan", body: "Hay fechas que merecen quedar escritas en algo dulce, para recordarlas cada vez que se prueban." },
          { title: "Con ternura, letra por letra", body: "Escribimos tu mensaje como si fuera una carta — despacio, con cuidado, para que llegue justo como lo sentís." },
        ],
      },
      {
        src: kb(6),
        alt: "Pastel blanco con corona plateada y mariposa",
        captions: [
          { title: "Elegancia hecha a mano", body: "Cada perla, cada detalle plateado, puesto uno por uno pensando en que ese día sea inolvidable." },
          { title: "Para momentos inolvidables", body: "Hay días que solo pasan una vez. Por eso ponemos todo el cuidado en que el pastel esté a la altura." },
        ],
      },
      {
        src: kb(7),
        alt: "Pastel de capas onduladas en degradé celeste",
        captions: [
          { title: "Capa por capa, con paciencia", body: "El tiempo que lleva cada textura es el mismo tiempo que le dedicamos a que todo te salga perfecto." },
          { title: "Hecho con calma, entregado con amor", body: "No apuramos el proceso. Cada onda de crema lleva su tiempo, como todo lo que vale la pena." },
        ],
      },
    ],
    contact: {
      whatsappUrl: "https://wa.me/14093325768?text=" + pastelMsg,
      smsUrl: "sms:+14093325768?body=" + pastelMsg,
    },
  },
];
