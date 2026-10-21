import json, argparse, sys, re, time
from duckduckgo_search import DDGS

DIRECTORY_DOMAINS = [
    "cnpj.biz", "cnpja.com", "casadosdados.com.br", "cnpjs.rocks",
    "consultasocio.com", "empresaqui.com.br", "speedio.com.br",
    "econodata.com.br", "infoplex.com.br", "receitafederal.gov.br",
    "cadastroempresa.com.br", "consultacnpj.com", "empregovaga.com",
    "glassdoor.com", "indeed.com", "jusbrasil.com.br",
    "reclameaqui.com.br", "linkedin.com/jobs", "vagas.com.br",
]

SOCIAL_PATTERNS = {
    "linkedin": r'https?://(?:www\.)?linkedin\.com/(?:company|in)/[^\s"\'<>\)]+',
    "instagram": r'https?://(?:www\.)?instagram\.com/[^\s"\'<>\)]+',
    "facebook": r'https?://(?:www\.)?facebook\.com/[^\s"\'<>\)]+',
    "twitter": r'https?://(?:www\.)?(?:twitter\.com|x\.com)/[^\s"\'<>\)]+',
    "youtube": r'https?://(?:www\.)?youtube\.com/(?:@|channel/|c/)[^\s"\'<>\)]+',
    "tiktok": r'https?://(?:www\.)?tiktok\.com/@[^\s"\'<>\)]+',
}

PHONE_RE = re.compile(r'(?:\+55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-.\s]?\d{4}')
EMAIL_RE = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')


def is_directory(url):
    if not url:
        return False
    lower = url.lower()
    return any(d in lower for d in DIRECTORY_DOMAINS)


def find_official_site(search_results, company_name):
    name_parts = re.sub(r'\b(ltda|s/?a|me|epp|eireli|ss)\b', '', company_name.lower(), flags=re.I)
    name_parts = re.sub(r'[^a-z0-9\s]', '', name_parts).split()
    name_parts = [p for p in name_parts if len(p) > 2]
    name_slug = ''.join(name_parts)

    candidates = []
    for q, hits in search_results.items():
        for h in hits:
            url = h.get("href", "")
            if not url or is_directory(url):
                continue
            domain = re.sub(r'https?://(www\.)?', '', url).split('/')[0].lower()
            domain_clean = domain.replace('.com.br', '').replace('.com', '').replace('.net.br', '').replace('.', '')
            score = sum(1 for p in name_parts if p in domain_clean)
            if domain_clean and name_slug and domain_clean in name_slug:
                score += 3
            elif domain_clean and name_slug and any(p in domain_clean for p in name_parts[:2]):
                score += 1
            is_site_query = "site oficial" in q.lower() or "fale conosco" in q.lower()
            if is_site_query:
                score += 1
            if score > 0 and not any(ext in domain for ext in [".gov.br", ".edu.br", "wikipedia", "youtube", "facebook", "linkedin", "instagram"]):
                base_url = re.match(r'(https?://[^/]+)', url)
                if base_url:
                    candidates.append((score, base_url.group(1), domain))
    if candidates:
        candidates.sort(key=lambda x: -x[0])
        return candidates[0][1]
    return None


def scrape_website(url):
    result = {
        "url": url,
        "seo": {},
        "social": {},
        "phones": [],
        "emails": [],
        "tech": [],
        "whatsapp": None,
    }
    try:
        import requests
        from bs4 import BeautifulSoup

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        }
        resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True, verify=False)
        resp.encoding = resp.apparent_encoding or "utf-8"
        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        title_tag = soup.find("title")
        result["seo"]["title"] = title_tag.get_text(strip=True) if title_tag else None

        meta_desc = soup.find("meta", attrs={"name": "description"})
        if meta_desc:
            result["seo"]["description"] = meta_desc.get("content", "")

        meta_kw = soup.find("meta", attrs={"name": "keywords"})
        if meta_kw:
            result["seo"]["keywords"] = meta_kw.get("content", "")

        og_image = soup.find("meta", attrs={"property": "og:image"})
        if og_image:
            result["seo"]["og_image"] = og_image.get("content", "")

        og_title = soup.find("meta", attrs={"property": "og:title"})
        if og_title:
            result["seo"]["og_title"] = og_title.get("content", "")

        og_desc = soup.find("meta", attrs={"property": "og:description"})
        if og_desc:
            result["seo"]["og_description"] = og_desc.get("content", "")

        canonical = soup.find("link", attrs={"rel": "canonical"})
        if canonical:
            result["seo"]["canonical"] = canonical.get("href", "")

        for platform, pattern in SOCIAL_PATTERNS.items():
            links = soup.find_all("a", href=re.compile(pattern, re.I))
            if links:
                href = links[0].get("href", "").rstrip("/")
                if platform == "linkedin" and "/jobs" in href:
                    continue
                result["social"][platform] = href

        for a in soup.find_all("a", href=True):
            href = a["href"]
            if "wa.me" in href or "whatsapp" in href.lower():
                nums = re.findall(r'\d+', href)
                if nums:
                    wanum = ''.join(nums)
                    if len(wanum) >= 10:
                        result["whatsapp"] = wanum
                        break

        all_text = soup.get_text(" ", strip=True)
        phones_found = set()
        for m in PHONE_RE.finditer(all_text):
            phone = re.sub(r'[^\d+]', '', m.group())
            if len(phone) >= 10 and len(phone) <= 15:
                phones_found.add(phone)
        for a in soup.find_all("a", href=re.compile(r'^tel:', re.I)):
            phone = re.sub(r'[^\d+]', '', a["href"].replace("tel:", ""))
            if len(phone) >= 10:
                phones_found.add(phone)
        result["phones"] = list(phones_found)[:10]

        emails_found = set()
        for m in EMAIL_RE.finditer(all_text):
            email = m.group().lower()
            if not any(x in email for x in [".png", ".jpg", ".gif", ".svg", ".css", ".js", "example.com", "sentry.io"]):
                emails_found.add(email)
        for a in soup.find_all("a", href=re.compile(r'^mailto:', re.I)):
            email = a["href"].replace("mailto:", "").split("?")[0].lower()
            if "@" in email:
                emails_found.add(email)
        result["emails"] = list(emails_found)[:10]

        tech = []
        html_lower = html.lower()
        if "ga(" in html_lower or "gtag(" in html_lower or "google-analytics" in html_lower:
            tech.append("Google Analytics")
            ga_match = re.search(r'(UA-\d+-\d+|G-[A-Z0-9]+)', html)
            if ga_match:
                result["seo"]["ga_id"] = ga_match.group(1)
        if "gtm.js" in html_lower or "googletagmanager" in html_lower:
            tech.append("Google Tag Manager")
            gtm_match = re.search(r'(GTM-[A-Z0-9]+)', html)
            if gtm_match:
                result["seo"]["gtm_id"] = gtm_match.group(1)
        if "fbq(" in html_lower or "facebook.com/tr" in html_lower:
            tech.append("Facebook Pixel")
        if "hotjar" in html_lower:
            tech.append("Hotjar")
        if "wp-content" in html_lower or "wordpress" in html_lower:
            tech.append("WordPress")
        if "shopify" in html_lower:
            tech.append("Shopify")
        if "wix.com" in html_lower:
            tech.append("Wix")
        if "squarespace" in html_lower:
            tech.append("Squarespace")
        if "react" in html_lower or "__next" in html_lower:
            tech.append("React")
        if "vue" in html_lower or "__vue" in html_lower:
            tech.append("Vue.js")
        if "bootstrap" in html_lower:
            tech.append("Bootstrap")
        if "tailwind" in html_lower:
            tech.append("Tailwind CSS")
        if "jquery" in html_lower:
            tech.append("jQuery")
        if "cloudflare" in html_lower:
            tech.append("Cloudflare")
        if "recaptcha" in html_lower:
            tech.append("reCAPTCHA")
        if "rdstation" in html_lower or "rd station" in html_lower:
            tech.append("RD Station")
        if "hubspot" in html_lower:
            tech.append("HubSpot")
        result["tech"] = tech

    except Exception as e:
        result["scrape_error"] = str(e)[:200]

    return result


def extract_social_from_search(search_results):
    found = {}
    for q, hits in search_results.items():
        for h in hits:
            href = h.get("href", "")
            body = h.get("body", "")
            title = h.get("title", "")
            combined = f"{href} {body} {title}"
            for platform, pattern in SOCIAL_PATTERNS.items():
                if platform not in found:
                    for m in re.finditer(pattern, combined, re.I):
                        url = m.group().rstrip("/")
                        if platform == "linkedin" and "/jobs" in url:
                            continue
                        found[platform] = url
                        break
    return found


def search_company(name, cnpj, queries):
    results = {}
    for q in queries:
        try:
            with DDGS() as ddgs:
                hits = list(ddgs.text(q, max_results=5, region="br-pt"))
                results[q] = [
                    {"title": h.get("title", ""), "body": h.get("body", ""), "href": h.get("href", "")}
                    for h in hits
                ]
        except Exception as e:
            results[q] = []
        time.sleep(0.8)
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", required=True)
    parser.add_argument("--cnpj", default="")
    parser.add_argument("--city", default="")
    parser.add_argument("--state", default="")
    parser.add_argument("--website", default="")
    args = parser.parse_args()

    name = args.name
    location = ""
    if args.city and args.state:
        location = f" {args.city} {args.state}"
    elif args.state:
        location = f" {args.state}"

    name_slug = re.sub(r'[^a-z0-9]', '', name.lower())
    name_first = name.split()[0].lower() if name.split() else name.lower()

    queries = [
        f'{name} site oficial{location}',
        f'"{name}" telefone contato comercial{location}',
        f'"{name}" email contato diretor gerente sócio',
        f'"{name}" linkedin instagram facebook rede social',
        f'"{name}" faturamento receita porte funcionários{location}',
        f'"{name}" investimento aquisição expansão projeto',
        f'"{name}" diretor sócio proprietário CEO fundador',
    ]
    if args.cnpj and len(args.cnpj) >= 14:
        queries.append(f'{args.cnpj} telefone email contato site')
        queries.append(f'{args.cnpj} faturamento receita funcionários')

    search_results = search_company(name, args.cnpj, queries)

    official_site = args.website if args.website and not is_directory(args.website) else None
    if not official_site:
        official_site = find_official_site(search_results, name)

    site_data = None
    if official_site:
        site_data = scrape_website(official_site)

    social_from_search = extract_social_from_search(search_results)

    merged_social = {}
    if site_data and site_data.get("social"):
        merged_social.update(site_data["social"])
    for k, v in social_from_search.items():
        if k not in merged_social:
            merged_social[k] = v

    output = {
        "searchResults": search_results,
        "officialSite": official_site,
        "siteData": site_data,
        "socialMedia": merged_social,
    }

    print(json.dumps(output, ensure_ascii=False))

if __name__ == "__main__":
    main()
