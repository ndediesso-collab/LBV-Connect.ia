"""Small, deterministic allowlist for provider-supplied web illustrations and links.

No arbitrary HTML, SVG, scripts, remote fetching or provider-secret fields reach a client.
"""
from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit
from typing import Any


def _https_url(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 1900:
        return None
    try:
        value = value.strip()
        url = urlsplit(value)
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            return None
        host = url.hostname.lower().rstrip(".")
        if "." not in host or host in {"localhost", "localhost.localdomain"} or host.endswith((".local", ".internal", ".localhost")):
            return None
        try:
            ip = ipaddress.ip_address(host)
            if not ip.is_global:
                return None
        except ValueError:
            pass
        return value
    except Exception:
        return None


def safe_images(items: Any) -> list[dict[str, Any]]:
    if not isinstance(items, (list, tuple)):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items[:12]:
        if not isinstance(item, dict):
            continue
        image = _https_url(item.get('image_url'))
        source = _https_url(item.get('source_url'))
        if not image or not source or image in seen:
            continue
        seen.add(image)
        position = item.get('after_paragraph')
        result.append({
            'image_url': image, 'source_url': source,
            'alt': str(item.get('alt') or item.get('caption') or 'Illustration Web')[:300],
            'caption': str(item.get('caption') or '')[:500],
            'after_paragraph': max(0, min(200, position)) if type(position) is int else 0,
        })
        if len(result) >= 3:
            break
    return result


def safe_sources(items: Any) -> list[dict[str, str]]:
    if not isinstance(items, (list, tuple)):
        return []
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in items[:30]:
        if not isinstance(item, dict):
            continue
        link = _https_url(item.get('url'))
        if not link or link in seen:
            continue
        seen.add(link)
        result.append({'url': link, 'title': str(item.get('title') or 'Source')[:180]})
        if len(result) >= 8:
            break
    return result
