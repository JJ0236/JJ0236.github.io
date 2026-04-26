/**
 * Instagram Analytics Proxy — Cloudflare Worker (Direct Scraping)
 *
 * No external services. Calls Instagram's own APIs directly.
 *
 * Endpoints:
 *   GET /?username=natgeo                → profile + first 12 posts + userId + cursor
 *   GET /?userId=123&cursor=ENDCURSOR    → next page of posts via GraphQL
 */

const IG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-IG-App-ID': '936619743392459',
  'X-Requested-With': 'XMLHttpRequest',
  'X-ASBD-ID': '129477',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Referer': 'https://www.instagram.com/',
};

// Anonymous GraphQL doc_id for edge_owner_to_timeline_media (from Instaloader)
const POSTS_DOC_ID = '7950326061742207';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const url = new URL(request.url);

    // ── Paginate posts via GraphQL ────────────────────────
    const userId = url.searchParams.get('userId');
    if (userId) {
      if (!/^\d{1,20}$/.test(userId)) {
        return json({ error: 'Invalid userId.' }, 400);
      }
      const cursor = url.searchParams.get('cursor') || '';
      return paginatePosts(userId, cursor);
    }

    // ── Profile + first posts ─────────────────────────────
    const username = (url.searchParams.get('username') || '').replace(/^@/, '').trim().toLowerCase();
    if (!username || !/^[a-z0-9._]{1,30}$/.test(username)) {
      return json({ error: 'Provide ?username= or ?userId=&cursor= parameter.' }, 400);
    }

    return fetchProfile(username);
  },
};

// ── Fetch profile via web_profile_info ──────────────────
async function fetchProfile(username) {
  const res = await fetch(
    `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    { headers: IG_HEADERS }
  );

  if (!res.ok) {
    return json({ error: `Profile fetch failed (${res.status}). Account may be private or not exist.` }, res.status === 404 ? 404 : 502);
  }

  const body = await res.json();
  const user = body?.data?.user;
  if (!user) {
    return json({ error: 'Could not parse profile. Account may be private or not exist.' }, 404);
  }

  const media = user.edge_owner_to_timeline_media;
  const edges = media?.edges ?? [];

  const profile = {
    username:    user.username,
    fullName:    user.full_name || user.username,
    biography:   user.biography || '',
    followers:   user.edge_followed_by?.count ?? 0,
    following:   user.edge_follow?.count ?? 0,
    totalPosts:  media?.count ?? 0,
    isVerified:  user.is_verified ?? false,
    isPrivate:   user.is_private ?? false,
    profilePic:  user.profile_pic_url_hd || user.profile_pic_url || '',
    externalUrl: user.external_url || '',
  };

  const posts = edges.map(({ node: p }) => parseGraphPost(p));

  return json({
    profile,
    posts,
    userId:    user.id || user.pk || null,
    cursor:    media?.page_info?.end_cursor || null,
    hasNext:   media?.page_info?.has_next_page ?? false,
  }, 200);
}

// ── Paginate posts via GraphQL doc_id POST ──────────────
async function paginatePosts(userId, cursor) {
  const variables = {
    id: userId,
    after: cursor || null,
    before: null,
    first: 12,
    last: null,
    __relay_internal__pv__PolarisFeedShareMenurelayprovider: false,
  };

  const body = new URLSearchParams({
    variables: JSON.stringify(variables),
    doc_id: POSTS_DOC_ID,
    server_timestamps: 'true',
  });

  const res = await fetch('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers: {
      ...IG_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    return json({ error: `GraphQL request failed (${res.status})` }, 502);
  }

  const data = await res.json();
  const edge = data?.data?.user?.edge_owner_to_timeline_media;

  if (!edge) {
    return json({ error: 'No post data in GraphQL response. May be rate-limited.' }, 502);
  }

  const posts = (edge.edges || []).map(({ node: p }) => parseGraphPost(p));

  return json({
    posts,
    cursor:  edge.page_info?.end_cursor || null,
    hasNext: edge.page_info?.has_next_page ?? false,
  }, 200);
}

// ── Parse a GraphQL post node ───────────────────────────
function parseGraphPost(p) {
  const cap = p.edge_media_to_caption?.edges?.[0]?.node?.text ?? '';
  return {
    shortcode: p.shortcode,
    url:       `https://www.instagram.com/p/${p.shortcode}/`,
    caption:   cap,
    timestamp: p.taken_at_timestamp ?? 0,
    type:      p.__typename === 'GraphVideo'   ? 'reel'
             : p.__typename === 'GraphSidecar' ? 'carousel'
             : 'image',
    thumbnail: p.thumbnail_src ?? p.display_url ?? '',
    likes:     p.edge_media_preview_like?.count ?? p.edge_liked_by?.count ?? 0,
    comments:  p.edge_media_to_comment?.count ?? 0,
    plays:     p.video_view_count ?? 0,
    isVideo:   p.is_video ?? false,
  };
}

// ── Helpers ─────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
