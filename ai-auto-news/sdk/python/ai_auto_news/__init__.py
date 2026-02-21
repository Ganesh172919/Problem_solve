"""
AI Auto News Python SDK

Official Python SDK for AI Auto News API
Supports: Posts, Generation, Analytics, Subscriptions, API Keys
"""

import time
import hmac
import hashlib
import requests
from typing import Optional, Dict, List, Any, Union
from dataclasses import dataclass
from enum import Enum


class ContentType(Enum):
    BLOG = "blog"
    NEWS = "news"


class Urgency(Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    BREAKING = "breaking"


@dataclass
class SDKConfig:
    api_key: str
    base_url: str = "https://api.ai-auto-news.com"
    timeout: int = 30
    retries: int = 3
    version: str = "v1"


@dataclass
class Post:
    id: str
    title: str
    content: str
    category: str
    slug: str
    published: bool
    created_at: str
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class APIResponse:
    success: bool
    data: Optional[Any] = None
    error: Optional[Dict[str, Any]] = None
    metadata: Optional[Dict[str, Any]] = None


class AIAutoNewsException(Exception):
    """Base exception for SDK errors"""
    def __init__(self, message: str, code: str = "error", details: Any = None):
        self.message = message
        self.code = code
        self.details = details
        super().__init__(self.message)


class Posts:
    """Posts API endpoints"""

    def __init__(self, client):
        self._client = client

    def list(
        self,
        page: int = 1,
        limit: int = 20,
        category: Optional[str] = None,
        published: Optional[bool] = None,
    ) -> List[Post]:
        """List all posts with pagination"""
        params = {"page": page, "limit": limit}
        if category:
            params["category"] = category
        if published is not None:
            params["published"] = published

        response = self._client._request("GET", "/posts", params=params)
        return [Post(**post) for post in response.data]

    def get(self, id_or_slug: str) -> Post:
        """Get a single post by ID or slug"""
        response = self._client._request("GET", f"/posts/{id_or_slug}")
        return Post(**response.data)

    def create(self, post_data: Dict[str, Any]) -> Post:
        """Create a new post"""
        response = self._client._request("POST", "/posts", body=post_data)
        return Post(**response.data)

    def update(self, post_id: str, post_data: Dict[str, Any]) -> Post:
        """Update an existing post"""
        response = self._client._request("PUT", f"/posts/{post_id}", body=post_data)
        return Post(**response.data)

    def delete(self, post_id: str) -> None:
        """Delete a post"""
        self._client._request("DELETE", f"/posts/{post_id}")

    def search(
        self, query: str, limit: int = 20, category: Optional[str] = None
    ) -> List[Post]:
        """Search posts"""
        params = {"q": query, "limit": limit}
        if category:
            params["category"] = category

        response = self._client._request("GET", "/search", params=params)
        return [Post(**post) for post in response.data]


class Generation:
    """Generation API endpoints"""

    def __init__(self, client):
        self._client = client

    def create(
        self,
        topic: str,
        content_type: ContentType = ContentType.BLOG,
        urgency: Optional[Urgency] = None,
        target_length: Optional[int] = None,
        tone: Optional[str] = None,
        audience: Optional[str] = None,
    ) -> Post:
        """Generate content"""
        body = {
            "topic": topic,
            "type": content_type.value,
        }
        if urgency:
            body["urgency"] = urgency.value
        if target_length:
            body["targetLength"] = target_length
        if tone:
            body["tone"] = tone
        if audience:
            body["audience"] = audience

        response = self._client._request("POST", "/generate", body=body)
        return Post(**response.data)

    def status(self, job_id: str) -> Dict[str, Any]:
        """Get generation status"""
        response = self._client._request("GET", f"/generate/{job_id}")
        return response.data


class Analytics:
    """Analytics API endpoints"""

    def __init__(self, client):
        self._client = client

    def usage(
        self,
        start: Optional[str] = None,
        end: Optional[str] = None,
        metric: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get usage statistics"""
        params = {}
        if start:
            params["start"] = start
        if end:
            params["end"] = end
        if metric:
            params["metric"] = metric

        response = self._client._request("GET", "/analytics/usage", params=params)
        return response.data

    def metrics(self) -> Dict[str, Any]:
        """Get performance metrics"""
        response = self._client._request("GET", "/analytics/metrics")
        return response.data


class Subscriptions:
    """Subscriptions API endpoints"""

    def __init__(self, client):
        self._client = client

    def get(self) -> Dict[str, Any]:
        """Get current subscription"""
        response = self._client._request("GET", "/subscriptions/current")
        return response.data

    def upgrade(self, tier: str) -> Dict[str, Any]:
        """Upgrade subscription"""
        response = self._client._request(
            "POST", "/subscriptions/upgrade", body={"tier": tier}
        )
        return response.data

    def cancel(self) -> None:
        """Cancel subscription"""
        self._client._request("POST", "/subscriptions/cancel")


class APIKeys:
    """API Keys management"""

    def __init__(self, client):
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        """List API keys"""
        response = self._client._request("GET", "/apikeys")
        return response.data

    def create(
        self,
        name: str,
        scopes: Optional[List[str]] = None,
        expires_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create new API key"""
        body = {"name": name}
        if scopes:
            body["scopes"] = scopes
        if expires_at:
            body["expiresAt"] = expires_at

        response = self._client._request("POST", "/apikeys", body=body)
        return response.data

    def revoke(self, key_id: str) -> None:
        """Revoke API key"""
        self._client._request("DELETE", f"/apikeys/{key_id}")


class Webhooks:
    """Webhooks management"""

    def __init__(self, client):
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        """List webhooks"""
        response = self._client._request("GET", "/webhooks")
        return response.data

    def create(
        self, url: str, events: List[str], secret: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create webhook"""
        body = {"url": url, "events": events}
        if secret:
            body["secret"] = secret

        response = self._client._request("POST", "/webhooks", body=body)
        return response.data

    def delete(self, webhook_id: str) -> None:
        """Delete webhook"""
        self._client._request("DELETE", f"/webhooks/{webhook_id}")


class AIAutoNewsSDK:
    """Main SDK client"""

    def __init__(self, config: Union[SDKConfig, str]):
        """
        Initialize SDK client

        Args:
            config: SDKConfig object or API key string
        """
        if isinstance(config, str):
            config = SDKConfig(api_key=config)

        self.config = config
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Authorization": f"Bearer {config.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "ai-auto-news-sdk-python/2.0.0",
            }
        )

        # Initialize API endpoints
        self.posts = Posts(self)
        self.generate = Generation(self)
        self.analytics = Analytics(self)
        self.subscriptions = Subscriptions(self)
        self.api_keys = APIKeys(self)
        self.webhooks = Webhooks(self)

    def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        body: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> APIResponse:
        """Make HTTP request with retry logic"""
        url = self._build_url(path)
        request_headers = dict(self.session.headers)
        if headers:
            request_headers.update(headers)

        last_error = None

        for attempt in range(self.config.retries):
            try:
                response = self.session.request(
                    method=method,
                    url=url,
                    params=params,
                    json=body,
                    headers=request_headers,
                    timeout=self.config.timeout,
                )

                data = response.json() if response.content else {}

                if not response.ok:
                    error = data.get("error", {})
                    raise AIAutoNewsException(
                        message=error.get("message", response.reason),
                        code=error.get("code", "request_failed"),
                        details=error.get("details"),
                    )

                return APIResponse(
                    success=True,
                    data=data.get("data", data),
                    metadata={
                        "request_id": response.headers.get("x-request-id", ""),
                        "rate_limit": {
                            "remaining": int(
                                response.headers.get("x-ratelimit-remaining", 0)
                            ),
                            "reset": response.headers.get("x-ratelimit-reset", ""),
                        },
                    },
                )

            except requests.exceptions.RequestException as e:
                last_error = e

                # Don't retry on client errors
                if hasattr(e, "response") and e.response is not None:
                    if 400 <= e.response.status_code < 500:
                        break

                # Exponential backoff
                if attempt < self.config.retries - 1:
                    time.sleep(2**attempt)

        raise AIAutoNewsException(
            message=str(last_error),
            code="request_failed",
            details=last_error,
        )

    def _build_url(self, path: str) -> str:
        """Build full URL"""
        return f"{self.config.base_url}/api/{self.config.version}{path}"

    @staticmethod
    def verify_webhook_signature(payload: str, signature: str, secret: str) -> bool:
        """Verify webhook signature"""
        expected = hmac.new(
            secret.encode(), payload.encode(), hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected)


def create_client(api_key: str, **kwargs) -> AIAutoNewsSDK:
    """
    Create SDK client instance

    Args:
        api_key: API key for authentication
        **kwargs: Additional config options (base_url, timeout, retries, version)

    Returns:
        AIAutoNewsSDK instance
    """
    config = SDKConfig(api_key=api_key, **kwargs)
    return AIAutoNewsSDK(config)


__all__ = [
    "AIAutoNewsSDK",
    "SDKConfig",
    "Post",
    "ContentType",
    "Urgency",
    "AIAutoNewsException",
    "create_client",
]
