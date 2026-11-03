'use strict';

// =============================================================================
// toPublicLink
// =============================================================================
// GoTrue's generateLink() can build action links (invite / password reset) from
// the request's host header instead of API_EXTERNAL_URL, which yields a URL the
// browser can't reach in dev. Rewrite the link's origin to SUPABASE_PUBLIC_URL
// (the browser-reachable Supabase address). No-op when it isn't set, or when the
// link already uses that origin (production).
// =============================================================================
const toPublicLink = (link) => {
    const publicUrl = process.env.SUPABASE_PUBLIC_URL;
    if (!link || !publicUrl) return link;

    try {
        const url = new URL(link);
        const target = new URL(publicUrl);
        url.protocol = target.protocol;
        url.host = target.host;
        return url.toString();
    } catch {
        return link;
    }
};

module.exports = { toPublicLink };
