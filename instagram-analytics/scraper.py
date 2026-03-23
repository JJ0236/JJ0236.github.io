#!/usr/bin/env python3
"""
Instagram Analytics Scraper
Uses Instaloader to fetch full post data (including likes & comments) for any
public—or logged-in—Instagram profile, then saves a JSON file you can drag
into the Instagram Analytics dashboard at jj0236.github.io/instagram-analytics/

Usage
-----
  # No login (post metadata only, no engagement counts):
  python scraper.py natgeo

  # With your Instagram session ID for full engagement data (likes + comments):
  python scraper.py natgeo --session-id YOUR_SESSION_ID

  # Limit number of posts (default: 50):
  python scraper.py natgeo --max-posts 100

  # Custom output path:
  python scraper.py natgeo --output my_data.json

How to get your Session ID
--------------------------
1. Open instagram.com in your browser and log in.
2. Open DevTools (F12) → Application tab → Cookies → https://www.instagram.com
3. Find the cookie named 'sessionid' and copy its value.
4. Pass it with --session-id "PASTE_HERE"

Your session ID is only used locally on your machine. It is never uploaded anywhere.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import instaloader
except ImportError:
    sys.exit(
        "instaloader is not installed.\n"
        "Run:  pip install instaloader\n"
        "Then retry."
    )


def fmt_ts(ts) -> str:
    """Convert a POSIX timestamp or datetime to an ISO-8601 string."""
    if isinstance(ts, datetime):
        return ts.astimezone(timezone.utc).isoformat()
    if ts:
        return datetime.fromtimestamp(int(ts), tz=timezone.utc).isoformat()
    return ""


def scrape(username: str, session_id: str | None, max_posts: int) -> dict:
    L = instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        quiet=False,
    )

    # Authenticate if a session ID was supplied
    if session_id:
        try:
            L.context.do_sleep = False
            # load_session_from_string needs the username and session id
            L.load_session(username, {"sessionid": session_id.strip()})
            print(f"[+] Loaded session for @{username}")
        except Exception as e:
            print(f"[!] Warning: could not load session — {e}")
            print("[!] Continuing without login (engagement data may be unavailable).")

    print(f"[+] Loading profile @{username}...")
    try:
        profile = instaloader.Profile.from_username(L.context, username)
    except instaloader.exceptions.ProfileNotExistsException:
        sys.exit(f"Profile @{username} does not exist.")
    except instaloader.exceptions.LoginRequiredException:
        sys.exit("Instagram requires login to view this profile. Use --session-id.")
    except Exception as e:
        sys.exit(f"Could not load profile: {e}")

    profile_data = {
        "username":     profile.username,
        "fullName":     profile.full_name,
        "biography":    profile.biography,
        "followers":    profile.followers,
        "following":    profile.followees,
        "totalPosts":   profile.mediacount,
        "isVerified":   profile.is_verified,
        "isPrivate":    profile.is_private,
        "profilePicUrl": profile.profile_pic_url,
        "externalUrl":  profile.external_url or "",
        "scrapedAt":    datetime.now(timezone.utc).isoformat(),
    }
    print(f"[+] Profile loaded: {profile.full_name} ({profile.followers:,} followers)")

    posts_out = []
    print(f"[+] Fetching up to {max_posts} posts...")

    try:
        for i, post in enumerate(profile.get_posts()):
            if i >= max_posts:
                break

            caption = post.caption or ""
            hashtags = [w[1:].strip(".,!?;:") for w in caption.split() if w.startswith("#")]

            entry = {
                "shortcode": post.shortcode,
                "url":        f"https://www.instagram.com/p/{post.shortcode}/",
                "caption":    caption,
                "timestamp":  post.date_utc.timestamp(),
                "date":       fmt_ts(post.date_utc),
                "type":       (
                    "reel"     if post.is_video and getattr(post, "product_type", "") in ("clips", "reel")
                    else "video"    if post.is_video
                    else "carousel" if post.typename == "GraphSidecar"
                    else "image"
                ),
                "likes":      post.likes,
                "comments":   post.comments,
                "plays":      post.video_view_count or 0,
                "hashtags":   hashtags,
                "location":   post.location.name if post.location else "",
                "thumbnail":  post.url,  # thumbnail / display URL
                "isVideo":    post.is_video,
            }
            posts_out.append(entry)

            # Progress
            eng = f"  ❤ {post.likes:,}  💬 {post.comments:,}" if post.likes else ""
            print(f"  [{i+1}/{max_posts}] {post.date_utc.date()} {post.typename}{eng}")

    except instaloader.exceptions.LoginRequiredException:
        print("[!] Instagram requires login to fetch post details.")
        print("[!] Use --session-id to pass your session cookie.")
    except Exception as e:
        print(f"[!] Stopped after {len(posts_out)} posts: {e}")

    has_engagement = any(p["likes"] > 0 for p in posts_out)

    return {
        "_meta": {
            "tool":          "jj0236.github.io/instagram-analytics",
            "scraped_at":    datetime.now(timezone.utc).isoformat(),
            "post_count":    len(posts_out),
            "has_engagement": has_engagement,
        },
        "profile": profile_data,
        "posts":   posts_out,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Scrape Instagram data for the Analytics Dashboard",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("username",    help="Instagram handle (with or without @)")
    parser.add_argument("--session-id", default=None, metavar="SESSION_ID",
                        help="Your Instagram sessionid cookie value (enables full engagement data)")
    parser.add_argument("--max-posts", type=int, default=50, metavar="N",
                        help="Maximum posts to fetch (default: 50)")
    parser.add_argument("--output",    default=None, metavar="FILE",
                        help="Output JSON path (default: <username>_analytics.json)")

    args = parser.parse_args()

    username = args.username.lstrip("@")
    out_path = Path(args.output or f"{username}_analytics.json")

    data = scrape(username, args.session_id, args.max_posts)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))

    print(f"\n✅ Saved {len(data['posts'])} posts → {out_path}")
    print(f"   Engagement data: {'YES (likes + comments)' if data['_meta']['has_engagement'] else 'NO (login required)'}")
    print(f"\n→ Drag {out_path} into the dashboard at:")
    print("   https://jj0236.github.io/instagram-analytics/")


if __name__ == "__main__":
    main()
