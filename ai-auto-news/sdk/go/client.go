// AI Auto News Go SDK
//
// Official Go SDK for AI Auto News API
// Supports: Posts, Generation, Analytics, Subscriptions, API Keys

package aiautonews

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// Config holds SDK configuration
type Config struct {
	APIKey     string
	BaseURL    string
	Timeout    time.Duration
	Retries    int
	Version    string
	HTTPClient *http.Client
}

// DefaultConfig returns default configuration
func DefaultConfig(apiKey string) *Config {
	return &Config{
		APIKey:  apiKey,
		BaseURL: "https://api.ai-auto-news.com",
		Timeout: 30 * time.Second,
		Retries: 3,
		Version: "v1",
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Post represents a blog post or news article
type Post struct {
	ID        string                 `json:"id"`
	Title     string                 `json:"title"`
	Content   string                 `json:"content"`
	Category  string                 `json:"category"`
	Slug      string                 `json:"slug"`
	Published bool                   `json:"published"`
	CreatedAt string                 `json:"createdAt"`
	Metadata  map[string]interface{} `json:"metadata,omitempty"`
}

// GenerateRequest represents content generation parameters
type GenerateRequest struct {
	Topic        string `json:"topic"`
	Type         string `json:"type"` // "blog" or "news"
	Urgency      string `json:"urgency,omitempty"`
	TargetLength int    `json:"targetLength,omitempty"`
	Tone         string `json:"tone,omitempty"`
	Audience     string `json:"audience,omitempty"`
}

// APIResponse wraps API responses
type APIResponse struct {
	Success  bool                   `json:"success"`
	Data     interface{}            `json:"data,omitempty"`
	Error    *APIError              `json:"error,omitempty"`
	Metadata map[string]interface{} `json:"metadata,omitempty"`
}

// APIError represents an API error
type APIError struct {
	Code    string      `json:"code"`
	Message string      `json:"message"`
	Details interface{} `json:"details,omitempty"`
}

// Client is the main SDK client
type Client struct {
	config *Config
	Posts  *PostsService
	Generate *GenerationService
	Analytics *AnalyticsService
	Subscriptions *SubscriptionsService
	APIKeys *APIKeysService
	Webhooks *WebhooksService
}

// NewClient creates a new SDK client
func NewClient(config *Config) *Client {
	if config == nil {
		panic("config cannot be nil")
	}

	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{
			Timeout: config.Timeout,
		}
	}

	client := &Client{
		config: config,
	}

	// Initialize services
	client.Posts = &PostsService{client: client}
	client.Generate = &GenerationService{client: client}
	client.Analytics = &AnalyticsService{client: client}
	client.Subscriptions = &SubscriptionsService{client: client}
	client.APIKeys = &APIKeysService{client: client}
	client.Webhooks = &WebhooksService{client: client}

	return client
}

// PostsService handles post operations
type PostsService struct {
	client *Client
}

// List retrieves posts with pagination
func (s *PostsService) List(ctx context.Context, params map[string]string) ([]Post, error) {
	var posts []Post
	err := s.client.request(ctx, "GET", "/posts", params, nil, &posts)
	return posts, err
}

// Get retrieves a single post
func (s *PostsService) Get(ctx context.Context, idOrSlug string) (*Post, error) {
	var post Post
	err := s.client.request(ctx, "GET", fmt.Sprintf("/posts/%s", idOrSlug), nil, nil, &post)
	return &post, err
}

// Create creates a new post
func (s *PostsService) Create(ctx context.Context, post *Post) (*Post, error) {
	var created Post
	err := s.client.request(ctx, "POST", "/posts", nil, post, &created)
	return &created, err
}

// Update updates an existing post
func (s *PostsService) Update(ctx context.Context, id string, post *Post) (*Post, error) {
	var updated Post
	err := s.client.request(ctx, "PUT", fmt.Sprintf("/posts/%s", id), nil, post, &updated)
	return &updated, err
}

// Delete deletes a post
func (s *PostsService) Delete(ctx context.Context, id string) error {
	return s.client.request(ctx, "DELETE", fmt.Sprintf("/posts/%s", id), nil, nil, nil)
}

// Search searches for posts
func (s *PostsService) Search(ctx context.Context, query string, params map[string]string) ([]Post, error) {
	if params == nil {
		params = make(map[string]string)
	}
	params["q"] = query

	var posts []Post
	err := s.client.request(ctx, "GET", "/search", params, nil, &posts)
	return posts, err
}

// GenerationService handles content generation
type GenerationService struct {
	client *Client
}

// Create generates content
func (s *GenerationService) Create(ctx context.Context, req *GenerateRequest) (*Post, error) {
	var post Post
	err := s.client.request(ctx, "POST", "/generate", nil, req, &post)
	return &post, err
}

// Status checks generation status
func (s *GenerationService) Status(ctx context.Context, jobID string) (map[string]interface{}, error) {
	var status map[string]interface{}
	err := s.client.request(ctx, "GET", fmt.Sprintf("/generate/%s", jobID), nil, nil, &status)
	return status, err
}

// AnalyticsService handles analytics operations
type AnalyticsService struct {
	client *Client
}

// Usage retrieves usage statistics
func (s *AnalyticsService) Usage(ctx context.Context, params map[string]string) (map[string]interface{}, error) {
	var usage map[string]interface{}
	err := s.client.request(ctx, "GET", "/analytics/usage", params, nil, &usage)
	return usage, err
}

// Metrics retrieves performance metrics
func (s *AnalyticsService) Metrics(ctx context.Context) (map[string]interface{}, error) {
	var metrics map[string]interface{}
	err := s.client.request(ctx, "GET", "/analytics/metrics", nil, nil, &metrics)
	return metrics, err
}

// SubscriptionsService handles subscription operations
type SubscriptionsService struct {
	client *Client
}

// Get retrieves current subscription
func (s *SubscriptionsService) Get(ctx context.Context) (map[string]interface{}, error) {
	var sub map[string]interface{}
	err := s.client.request(ctx, "GET", "/subscriptions/current", nil, nil, &sub)
	return sub, err
}

// Upgrade upgrades subscription tier
func (s *SubscriptionsService) Upgrade(ctx context.Context, tier string) (map[string]interface{}, error) {
	var result map[string]interface{}
	body := map[string]string{"tier": tier}
	err := s.client.request(ctx, "POST", "/subscriptions/upgrade", nil, body, &result)
	return result, err
}

// Cancel cancels subscription
func (s *SubscriptionsService) Cancel(ctx context.Context) error {
	return s.client.request(ctx, "POST", "/subscriptions/cancel", nil, nil, nil)
}

// APIKeysService handles API key operations
type APIKeysService struct {
	client *Client
}

// List retrieves API keys
func (s *APIKeysService) List(ctx context.Context) ([]map[string]interface{}, error) {
	var keys []map[string]interface{}
	err := s.client.request(ctx, "GET", "/apikeys", nil, nil, &keys)
	return keys, err
}

// Create creates a new API key
func (s *APIKeysService) Create(ctx context.Context, params map[string]interface{}) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := s.client.request(ctx, "POST", "/apikeys", nil, params, &result)
	return result, err
}

// Revoke revokes an API key
func (s *APIKeysService) Revoke(ctx context.Context, keyID string) error {
	return s.client.request(ctx, "DELETE", fmt.Sprintf("/apikeys/%s", keyID), nil, nil, nil)
}

// WebhooksService handles webhook operations
type WebhooksService struct {
	client *Client
}

// List retrieves webhooks
func (s *WebhooksService) List(ctx context.Context) ([]map[string]interface{}, error) {
	var webhooks []map[string]interface{}
	err := s.client.request(ctx, "GET", "/webhooks", nil, nil, &webhooks)
	return webhooks, err
}

// Create creates a webhook
func (s *WebhooksService) Create(ctx context.Context, params map[string]interface{}) (map[string]interface{}, error) {
	var result map[string]interface{}
	err := s.client.request(ctx, "POST", "/webhooks", nil, params, &result)
	return result, err
}

// Delete deletes a webhook
func (s *WebhooksService) Delete(ctx context.Context, webhookID string) error {
	return s.client.request(ctx, "DELETE", fmt.Sprintf("/webhooks/%s", webhookID), nil, nil, nil)
}

// request makes an HTTP request with retry logic
func (c *Client) request(ctx context.Context, method, path string, params map[string]string, body, result interface{}) error {
	reqURL := c.buildURL(path, params)

	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("failed to marshal request body: %w", err)
		}
		reqBody = bytes.NewReader(data)
	}

	var lastErr error

	for attempt := 0; attempt < c.config.Retries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, reqURL, reqBody)
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}

		req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.config.APIKey))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "ai-auto-news-sdk-go/2.0.0")

		resp, err := c.config.HTTPClient.Do(req)
		if err != nil {
			lastErr = err
			if attempt < c.config.Retries-1 {
				time.Sleep(time.Duration(1<<uint(attempt)) * time.Second)
				continue
			}
			return fmt.Errorf("request failed after %d attempts: %w", c.config.Retries, err)
		}
		defer resp.Body.Close()

		respBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read response body: %w", err)
		}

		if resp.StatusCode >= 400 {
			var apiResp APIResponse
			if err := json.Unmarshal(respBody, &apiResp); err == nil && apiResp.Error != nil {
				return fmt.Errorf("API error: %s - %s", apiResp.Error.Code, apiResp.Error.Message)
			}
			return fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(respBody))
		}

		if result != nil {
			var apiResp APIResponse
			if err := json.Unmarshal(respBody, &apiResp); err != nil {
				return fmt.Errorf("failed to unmarshal response: %w", err)
			}

			// Marshal and unmarshal to convert to target type
			data, err := json.Marshal(apiResp.Data)
			if err != nil {
				return fmt.Errorf("failed to marshal response data: %w", err)
			}

			if err := json.Unmarshal(data, result); err != nil {
				return fmt.Errorf("failed to unmarshal to result type: %w", err)
			}
		}

		return nil
	}

	return lastErr
}

// buildURL constructs the full API URL
func (c *Client) buildURL(path string, params map[string]string) string {
	u := fmt.Sprintf("%s/api/%s%s", c.config.BaseURL, c.config.Version, path)

	if len(params) > 0 {
		values := url.Values{}
		for k, v := range params {
			values.Add(k, v)
		}
		u += "?" + values.Encode()
	}

	return u
}

// VerifyWebhookSignature verifies a webhook signature
func VerifyWebhookSignature(payload, signature, secret string) bool {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(payload))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(signature), []byte(expected))
}
