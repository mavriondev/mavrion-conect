#!/usr/bin/env python3
"""
Web enrichment scraper for company leads.
Usage: python3 scraper.py --name "ACME SA" --cnpj "12345678000190" [--website "acme.com.br"]
Output: JSON to stdout
"""

import sys
import json
import re
import argparse
import unicodedata

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

try:
    import phonenumbers
    HAS_PHONENUMBERS = True
except ImportError:
    HAS_PHONENUMBERS = False

HAS_DDG = False
DDG_USE_CONTEXT = False
try:
    from ddgs import DDGS
    HAS_DDG = True
    DDG_USE_CONTEXT = False
except ImportError:
    try:
        from duckduckgo_search import DDGS
        HAS_DDG = True
        DDG_USE_CONTEXT = True
    except ImportError:
        pass

# ── Regex patterns ─────────────────────────────────────────────────────────────

SOCIAL_PATTERNS = {
    "linkedin":  r"(?:https?://)?(?:www\.)?linkedin\.com/company/[\w\-\%\.]+",
    "instagram": r"(?:https?://)?(?:www\.)?instagram\.com/[\w\.\-]+/?",
    "facebook":  r"(?:https?://)?(?:www\.)?facebook\.com/(?!sharer|share|login|help|policies|legal|pg/)[\w\.\-]+(?:/[\w\.\-]+)?",
    "twitter":   r"(?:https?://)?(?:www\.)?(?:twitter|x)\.com/(?!intent/|share\b)[\w]+",
    "youtube":   r"(?:https?://)?(?:www\.)?youtube\.com/(?:c/|channel/|@|user/)?[\w\.\-@]+",
    "whatsapp":  r"(?:https?://)?(?:api\.whatsapp\.com|wa\.me)/\S+",
    "tiktok":    r"(?:https?://)?(?:www\.)?tiktok\.com/@[\w\.\-]+",
}

EMAIL_RE   = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}")
PHONE_RE   = re.compile(r"(?:\+?55[\s\-]?)?(?:\(?0?\d{2}\)?[\s\-]?)(?:9\s?\d{4}|\d{4})[\s\-]?\d{4}")

EMAIL_BLACKLIST = {
    "example.com", "domain.com", "email.com", "site.com", "sentry.io",
    "wixpress.com", "squarespace.com", "nr-data.net", "google.com",
    "schema.org", "w3.org", "facebook.com", "apple.com", "microsoft.com",
    "amazonaws.com", "cloudfront.net", "googleapis.com",
}

SOCIAL_BLACKLIST = {
    "linkedin.com/company/linkedin",
    "facebook.com/facebook",
    "instagram.com/instagram",
    "instagram.com/accounts",
    "instagram.com/p/",
    "facebook.com/sharer",
    "facebook.com/share",
    "twitter.com/intent",
    "tiktok.com/@tiktok",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}

# Sites that aggregate public CNPJ data — not the company's real site
CNPJ_DIRECTORY_DOMAINS = [
    "cnpj.biz", "casadosdados.com.br", "cnpja.com", "cnpj.info",
    "receitafederal.gov.br", "sintegra.", "minhareceita.org",
    "qsa.serpro", "econodata.com.br", "empresaqui.com.br",
    "guiamais.com.br", "telelistas.net", "encontre.inf.br",
    "apontador.com", "99empresas.com.br", "consulta.org",
    "jusbrasil.com.br/empresa", "reclameaqui.com.br", "portaldatransparencia.gov.br",
    "buscar.org.br", "einforma.com", "nexo.io", "receita.economia.gov.br",
    "descubraonline.com", "yellowpages.com.br", "infobel.com",
    "empresas.cnpj.ws", "receitaws.com.br", "cnpjbrasil.com.br",
    "sociosbrasil.com", "transparencia.cc", "consultacnpj.com",
]

NOT_COMPANY_DOMAINS = CNPJ_DIRECTORY_DOMAINS + [
    "facebook.", "instagram.", "linkedin.", "youtube.", "twitter.", "x.com",
    "google.", "tiktok.com", "whatsapp.", "wa.me",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def normalize_str(s: str) -> str:
    """Lowercase and remove accents for fuzzy comparison."""
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )


def is_cnpj_directory(url: str) -> bool:
    return any(d in url for d in CNPJ_DIRECTORY_DOMAINS)


def extract_phones(text: str, known_phones: list[str] | None = None) -> list[str]:
    known_digits = {re.sub(r"\D", "", p) for p in (known_phones or [])}
    found = []
    seen_digits: set[str] = set()
    for m in PHONE_RE.finditer(text):
        raw = m.group().strip()
        digits = re.sub(r"\D", "", raw)
        # Brazilian numbers: DDD (2 digits) + 8 or 9 digit number = 10 or 11
        if len(digits) < 10 or len(digits) > 11:
            continue
        # Skip if starts with area code 00 or impossible area codes
        area = digits[:2]
        if area in ("00", "01"):
            continue
        if digits in seen_digits or digits in known_digits:
            continue
        seen_digits.add(digits)
        if HAS_PHONENUMBERS:
            try:
                parsed = phonenumbers.parse("+" + ("55" + digits if len(digits) <= 11 else digits), None)
                if phonenumbers.is_valid_number(parsed):
                    fmt = phonenumbers.format_number(
                        parsed, phonenumbers.PhoneNumberFormat.NATIONAL
                    )
                    found.append(fmt)
                    continue
            except Exception:
                pass
        # Fallback: format manually
        if len(digits) == 11:
            found.append(f"({digits[:2]}) {digits[2:7]}-{digits[7:]}")
        else:
            found.append(f"({digits[:2]}) {digits[2:6]}-{digits[6:]}")
    return found[:6]


def extract_emails(text: str) -> list[str]:
    found = []
    seen: set[str] = set()
    for m in EMAIL_RE.finditer(text):
        e = m.group().lower()
        domain = e.split("@")[1]
        if domain in EMAIL_BLACKLIST:
            continue
        if any(bl in domain for bl in ["noreply", "no-reply", "donotreply"]):
            continue
        if e in seen:
            continue
        seen.add(e)
        found.append(e)
    return found[:8]


def clean_social_url(url: str, platform: str) -> str | None:
    """Normalize and validate a social URL."""
    if not url.startswith("http"):
        url = "https://" + url.lstrip("/")
    # Strip query strings and fragments
    url = url.split("?")[0].split("#")[0].rstrip("/")
    # Check blacklist
    if any(bl in url for bl in SOCIAL_BLACKLIST):
        return None

    # Platform specific cleanup
    if platform == "linkedin":
        # Normalize company IDs to slugs if possible
        url = re.sub(r"/company/(\d+)/?$", r"/company/\1", url)
    elif platform == "tiktok":
        # Ensure it has the @
        if "tiktok.com/" in url and "tiktok.com/@" not in url:
            url = url.replace("tiktok.com/", "tiktok.com/@")

    # Remove /about, /posts etc from common social links
    url = re.sub(r"/(about|posts|jobs|life|people|videos|reels)/?$", "", url)
    url = url.rstrip("/")

    # Check minimum length for meaningful handles
    parts = url.split("/")
    handle = parts[-1] if parts else ""
    if len(handle) < 2:
        return None
    return url


def extract_social(text: str) -> dict[str, str]:
    found = {}
    for platform, pattern in SOCIAL_PATTERNS.items():
        if platform in found:
            continue
        for m in re.finditer(pattern, text, re.IGNORECASE):
            url = clean_social_url(m.group(), platform)
            if url:
                found[platform] = url
                break
    return found


# ── Website scraper ────────────────────────────────────────────────────────────

def scrape_website(url: str, known_phones: list[str] | None = None) -> dict:
    if not HAS_REQUESTS or not HAS_BS4:
        return {"error": "missing_dependencies", "details": f"requests={HAS_REQUESTS}, bs4={HAS_BS4}"}

    if not url.startswith("http"):
        url = "https://" + url

    if is_cnpj_directory(url):
        return {"error": "cnpj_directory", "website": url}

    try:
        resp = requests.get(url, headers=HEADERS, timeout=14, allow_redirects=True)
        resp.raise_for_status()
    except Exception as e:
        try:
            alt = url.replace("https://", "http://")
            if alt != url:
                resp = requests.get(alt, headers=HEADERS, timeout=12, allow_redirects=True)
        except Exception as e2:
            return {"error": str(e2)}

    final_url = resp.url
    html = resp.text
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")

    def meta(name=None, prop=None):
        tag = (
            soup.find("meta", attrs={"name": name}) if name
            else soup.find("meta", attrs={"property": prop})
        )
        return tag.get("content", "").strip() if tag and tag.get("content") else None

    title_tag = soup.find("title")
    page_title = title_tag.get_text().strip() if title_tag else None

    canonical_tag = soup.find("link", rel="canonical")
    canonical = canonical_tag.get("href") if canonical_tag else None

    # Gather all text
    page_text = soup.get_text(" ", strip=True)
    all_hrefs = " ".join(a.get("href", "") for a in soup.find_all("a", href=True))
    full_text = page_text + " " + all_hrefs + " " + html

    # Technology detection
    tech = []
    tech_checks = [
        ("WordPress",        ["wp-content", "wp-includes", "/wordpress"]),
        ("Shopify",          ["shopify.com", "cdn.shopify"]),
        ("Wix",              ["wix.com", "_wix_", "wixstatic"]),
        ("Webflow",          ["webflow.com", "webflow.js"]),
        ("VTEX",             ["vtex.com", "vtexcommercestable", "vteximg"]),
        ("Linx",             ["linximpulse", "linx.com.br"]),
        ("Magento",          ["mage/cookies", "magento", "js/mage/"]),
        ("React",            ["react.development.js", "react.production.min", "__react"]),
        ("Next.js",          ["/_next/", "__next", "next.js"]),
        ("Google Analytics", ["google-analytics.com", "googletagmanager.com", "gtag("]),
        ("Google Tag Manager", ["googletagmanager.com", "GTM-"]),
        ("Facebook Pixel",   ["fbq(", "facebook.net/en_US/fbevents"]),
        ("Hotjar",           ["hotjar.com", "hjBootstrap", "hj("]),
        ("RD Station",       ["rdstation", "rd.js", "rdstation.com"]),
        ("Intercom",         ["intercom.io", "intercomSettings"]),
        ("Zendesk",          ["zendesk.com", "zESettings"]),
        ("HubSpot",          ["hubspot.com", "hs-scripts.com", "hbspt"]),
    ]
    for name, signals in tech_checks:
        if any(s in html for s in signals):
            tech.append(name)

    ga_match = re.search(r"\b(UA-\d{4,}-\d+|G-[A-Z0-9]{6,})\b", html)
    ga_id = ga_match.group(1) if ga_match else None

    gtm_match = re.search(r"\b(GTM-[A-Z0-9]{4,})\b", html)
    gtm_id = gtm_match.group(1) if gtm_match else None

    # Extract WhatsApp number from wa.me links
    wa_links = re.findall(r"wa\.me/(\d+)", html)
    whatsapp_num = wa_links[0] if wa_links else None

    return {
        "website":      final_url,
        "canonical":    canonical,
        "is_directory": False,
        "seo": {
            "title":          page_title,
            "description":    meta(name="description") or meta(prop="og:description"),
            "keywords":       meta(name="keywords"),
            "og_title":       meta(prop="og:title"),
            "og_description": meta(prop="og:description"),
            "og_image":       meta(prop="og:image"),
            "og_type":        meta(prop="og:type"),
            "robots":         meta(name="robots"),
            "canonical":      canonical,
        },
        "emails":        extract_emails(full_text),
        "phones":        extract_phones(page_text, known_phones),
        "social":        extract_social(full_text),
        "tech":          tech,
        "ga_id":         ga_id,
        "gtm_id":        gtm_id,
        "whatsapp_num":  whatsapp_num,
    }


# ── DuckDuckGo search ──────────────────────────────────────────────────────────

def score_site_for_company(url: str, name: str) -> float:
    """Score a URL as a potential official company website (0-1)."""
    if is_cnpj_directory(url):
        return 0.0
    score = 0.5
    name_words = [w for w in normalize_str(name).split() if len(w) > 3
                  and w not in ("ltda", "eireli", "sa", "epp", "mei", "the", "and")]
    domain = url.split("/")[2].replace("www.", "") if "//" in url else url
    norm_domain = normalize_str(domain)
    matches = sum(1 for w in name_words if w in norm_domain)
    score += matches * 0.2
    if domain.endswith(".com.br") or domain.endswith(".br"):
        score += 0.15
    return min(score, 1.0)


def search_company(name: str, cnpj: str, known_phones: list[str] | None = None) -> dict:
    if not HAS_DDG:
        return {"error": "duckduckgo-search not available"}

    search_results = []
    social: dict[str, str] = {}
    official_site = None
    official_site_score = 0.0
    phones: list[str] = []
    emails: list[str] = []

    ddgs = DDGS()

    try:
        q1 = f'"{name}" CNPJ {cnpj} site oficial contato'
        for r in ddgs.text(q1, max_results=8):
            href  = r.get("href", "")
            body  = r.get("body", "")
            title = r.get("title", "")
            search_results.append({"title": title, "url": href, "snippet": body[:200]})
            combo = body + " " + href
            social.update({k: v for k, v in extract_social(combo).items() if k not in social})
            phones += extract_phones(body, known_phones)
            emails += extract_emails(body)
            s = score_site_for_company(href, name)
            if s > official_site_score:
                official_site_score = s
                official_site = href

        # 2. Direct name search without CNPJ for broader discovery
        q2 = f'"{name}" site oficial'
        for r in ddgs.text(q2, max_results=4):
            href = r.get("href", "")
            body = r.get("body", "")
            combo = body + " " + href
            social.update({k: v for k, v in extract_social(combo).items() if k not in social})
            s = score_site_for_company(href, name)
            if s > official_site_score and not is_cnpj_directory(href):
                official_site_score = s
                official_site = href

        # 3. LinkedIn dedicated search
        q3 = f"{name} site:linkedin.com/company"
        for r in ddgs.text(q3, max_results=3):
            href = r.get("href", "")
            if "linkedin.com/company" in href and "linkedin" not in social:
                cleaned = clean_social_url(href, "linkedin")
                if cleaned:
                    social["linkedin"] = cleaned

        # 4. Instagram/Facebook/TikTok search
        q4 = f"{name} instagram OR facebook OR tiktok perfil empresa brasileiro"
        for r in ddgs.text(q4, max_results=6):
            href = r.get("href", "")
            body = r.get("body", "")
            combo = body + " " + href
            for k, v in extract_social(combo).items():
                if k not in social:
                    social[k] = v

        # 5. Dedicated TikTok search
        q5 = f"{name} site:tiktok.com"
        for r in ddgs.text(q5, max_results=3):
            href = r.get("href", "")
            if "tiktok.com/@" in href and "tiktok" not in social:
                cleaned = clean_social_url(href, "tiktok")
                if cleaned:
                    social["tiktok"] = cleaned
    except Exception as e:
        sys.stderr.write(f"[DDG] search error: {e}\n")

    # Reject if official_site is a directory with low score
    if official_site and official_site_score < 0.3:
        official_site = None

    # Deduplicate
    phones = list(dict.fromkeys(phones))[:6]
    emails = list(dict.fromkeys(emails))[:6]

    return {
        "official_site":       official_site,
        "official_site_score": round(official_site_score, 2),
        "social":              social,
        "phones_from_search":  phones,
        "emails_from_search":  emails,
        "search_results":      search_results[:6],
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Enrich a company with web data")
    parser.add_argument("--name",    required=True,  help="Company legal or trade name")
    parser.add_argument("--cnpj",    default="",     help="CNPJ for more precise search")
    parser.add_argument("--website", default="",     help="Known website to scrape directly")
    parser.add_argument("--phones",  default="",     help="Known phones (comma-separated) to deduplicate")
    args = parser.parse_args()

    known_phones = [p.strip() for p in args.phones.split(",") if p.strip()] if args.phones else []

    output: dict = {
        "name":         args.name,
        "cnpj":         args.cnpj,
        "search":       {},
        "website_data": {},
        "merged":       {},
    }

    # Step 1 — web search
    search_data: dict = {}
    try:
        search_data = search_company(args.name, args.cnpj, known_phones)
        output["search"] = search_data
    except Exception as e:
        output["search"] = {"error": str(e)}

    # Step 2 — determine site to scrape
    # Prefer: known website → high-confidence search result → skip directory
    site_url = args.website or ""
    if site_url and is_cnpj_directory(site_url):
        site_url = search_data.get("official_site", "")
    if not site_url:
        site_url = search_data.get("official_site", "")

    site_data: dict = {}
    if site_url and not is_cnpj_directory(site_url):
        try:
            site_data = scrape_website(site_url, known_phones)
            output["website_data"] = site_data
        except Exception as e:
            output["website_data"] = {"error": str(e)}
    else:
        output["website_data"] = {"skipped": "no_valid_site"}

    # Step 3 — merge best data
    all_phones = list(dict.fromkeys(
        site_data.get("phones", []) + search_data.get("phones_from_search", [])
    ))[:6]
    all_emails = list(dict.fromkeys(
        site_data.get("emails", []) + search_data.get("emails_from_search", [])
    ))[:6]
    # Merge social: website data overrides (more reliable)
    merged_social = {**search_data.get("social", {}), **site_data.get("social", {})}

    # SEO is only valid from actual company site (not directories)
    seo = {}
    if site_data and not site_data.get("error") and not site_data.get("skipped") and not site_data.get("is_directory"):
        seo = site_data.get("seo", {})

    output["merged"] = {
        "website":           site_data.get("website") or site_url or None,
        "website_score":     search_data.get("official_site_score", 0),
        "is_directory_site": is_cnpj_directory(site_data.get("website", "") or site_url),
        "phones":            all_phones,
        "emails":            all_emails,
        "social":            merged_social,
        "seo":               seo,
        "tech":              site_data.get("tech", []),
        "ga_id":             site_data.get("ga_id"),
        "gtm_id":            site_data.get("gtm_id"),
        "whatsapp_num":      site_data.get("whatsapp_num"),
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
