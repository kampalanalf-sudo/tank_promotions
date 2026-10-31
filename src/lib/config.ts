// Supabase connection. Set these in a `.env` file in the project folder:
//   VITE_SUPABASE_URL=https://xxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJ...
// The anon key is designed to be public; access is controlled by the
// row-level security rules in supabase/schema.sql.
// When they are not set, the site runs in "this device only" mode.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || "";

// The one account that gets the admin desk. Must match ADMIN_EMAIL in supabase/schema.sql.
export const ADMIN_EMAIL = "admin@tanktickets.site";

export const CONTACT_PHONE = "256775497509";
export const CONTACT_PHONE_LABEL = "+256 775 497 509";
// Logo files live in public/ and are published with the site.
export const LOGO_URL = "./logo.jpg"; // full logo with wording
export const LOGO_ICON_URL = "./logo-icon.jpg"; // TP stopwatch emblem for small round badges
export const LOGO_REMOTE_URL = "https://tankpromotions.online/images/logo.jpg"; // backup copy
