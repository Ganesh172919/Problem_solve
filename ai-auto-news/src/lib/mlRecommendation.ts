interface RecommendationItem {
  id: string;
  title: string;
  score: number;
  features: number[];
  metadata: Record<string, any>;
}

interface UserBehavior {
  userId: string;
  interactions: Interaction[];
  preferences: Record<string, number>;
}

interface Interaction {
  itemId: string;
  type: 'view' | 'like' | 'share' | 'generate' | 'search';
  timestamp: number;
  duration?: number;
  metadata?: Record<string, any>;
}

export class MLRecommendationEngine {
  private userBehaviors: Map<string, UserBehavior> = new Map();
  private itemFeatures: Map<string, number[]> = new Map();
  private collaborativeMatrix: Map<string, Map<string, number>> = new Map();

  /**
   * Track user interaction
   */
  trackInteraction(
    userId: string,
    itemId: string,
    type: Interaction['type'],
    metadata?: Record<string, any>
  ): void {
    let behavior = this.userBehaviors.get(userId);
    if (!behavior) {
      behavior = {
        userId,
        interactions: [],
        preferences: {},
      };
      this.userBehaviors.set(userId, behavior);
    }

    behavior.interactions.push({
      itemId,
      type,
      timestamp: Date.now(),
      metadata,
    });

    // Update preferences
    this.updateUserPreferences(userId, itemId, type);

    // Trim old interactions (keep last 1000)
    if (behavior.interactions.length > 1000) {
      behavior.interactions = behavior.interactions.slice(-1000);
    }
  }

  /**
   * Update user preferences based on interaction
   */
  private updateUserPreferences(
    userId: string,
    itemId: string,
    type: Interaction['type']
  ): void {
    const behavior = this.userBehaviors.get(userId);
    if (!behavior) return;

    // Weight interactions by type
    const weights = {
      view: 1,
      like: 3,
      share: 5,
      generate: 7,
      search: 2,
    };

    const weight = weights[type];
    const itemFeatures = this.itemFeatures.get(itemId);

    if (itemFeatures) {
      itemFeatures.forEach((feature, index) => {
        const prefKey = `feature_${index}`;
        behavior.preferences[prefKey] = (behavior.preferences[prefKey] || 0) + feature * weight;
      });
    }
  }

  /**
   * Extract features from content
   */
  extractFeatures(item: {
    title: string;
    content: string;
    tags: string[];
    category: string;
  }): number[] {
    const features: number[] = [];

    // Feature 1: Title length (normalized)
    features.push(item.title.length / 100);

    // Feature 2: Content length (normalized)
    features.push(item.content.length / 5000);

    // Feature 3-7: Category encoding (one-hot)
    const categories = ['blog', 'news', 'tutorial', 'analysis', 'announcement'];
    categories.forEach(cat => {
      features.push(item.category === cat ? 1 : 0);
    });

    // Feature 8-17: Tag frequency (top 10 tags)
    const commonTags = ['AI', 'tech', 'programming', 'cloud', 'data', 'security', 'mobile', 'web', 'devops', 'ml'];
    commonTags.forEach(tag => {
      features.push(item.tags.some(t => t.toLowerCase().includes(tag.toLowerCase())) ? 1 : 0);
    });

    // Feature 18: Word count
    const wordCount = item.content.split(/\s+/).length;
    features.push(wordCount / 1000);

    // Feature 19: Average word length
    const avgWordLength = item.content.split(/\s+/).reduce((sum, word) => sum + word.length, 0) / wordCount;
    features.push(avgWordLength / 10);

    // Feature 20: Question count (engagement indicator)
    const questionCount = (item.content.match(/\?/g) || []).length;
    features.push(questionCount / 10);

    return features;
  }

  /**
   * Store item features
   */
  storeItemFeatures(itemId: string, features: number[]): void {
    this.itemFeatures.set(itemId, features);
  }

  /**
   * Calculate cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
  }

  /**
   * Get content-based recommendations
   */
  async getContentBasedRecommendations(
    userId: string,
    candidateItems: RecommendationItem[],
    limit: number = 10
  ): Promise<RecommendationItem[]> {
    const behavior = this.userBehaviors.get(userId);
    if (!behavior || Object.keys(behavior.preferences).length === 0) {
      // Cold start: return popular items
      return candidateItems.sort((a, b) => b.score - a.score).slice(0, limit);
    }

    // Create user preference vector
    const userVector = this.createUserVector(behavior);

    // Score items based on similarity to user preferences
    const scoredItems = candidateItems.map(item => {
      const similarity = this.cosineSimilarity(userVector, item.features);
      return {
        ...item,
        score: similarity * 100,
      };
    });

    // Sort by score and return top N
    return scoredItems.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Create user preference vector
   */
  private createUserVector(behavior: UserBehavior): number[] {
    const vector: number[] = [];
    const maxFeatureIndex = Math.max(
      ...Object.keys(behavior.preferences)
        .filter(k => k.startsWith('feature_'))
        .map(k => parseInt(k.split('_')[1]))
    );

    for (let i = 0; i <= maxFeatureIndex; i++) {
      const value = behavior.preferences[`feature_${i}`] || 0;
      vector.push(value);
    }

    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? vector.map(v => v / norm) : vector;
  }

  /**
   * Get collaborative filtering recommendations
   */
  async getCollaborativeRecommendations(
    userId: string,
    candidateItems: RecommendationItem[],
    limit: number = 10
  ): Promise<RecommendationItem[]> {
    // Find similar users
    const similarUsers = this.findSimilarUsers(userId, 20);

    // Aggregate recommendations from similar users
    const itemScores: Map<string, number> = new Map();

    for (const [similarUserId, similarity] of similarUsers) {
      const behavior = this.userBehaviors.get(similarUserId);
      if (!behavior) continue;

      // Get items this user liked
      const likedItems = behavior.interactions
        .filter(i => i.type === 'like' || i.type === 'generate')
        .map(i => i.itemId);

      likedItems.forEach(itemId => {
        const currentScore = itemScores.get(itemId) || 0;
        itemScores.set(itemId, currentScore + similarity);
      });
    }

    // Score candidate items
    const scoredItems = candidateItems.map(item => ({
      ...item,
      score: itemScores.get(item.id) || 0,
    }));

    return scoredItems.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Find similar users
   */
  private findSimilarUsers(userId: string, limit: number): Array<[string, number]> {
    const userBehavior = this.userBehaviors.get(userId);
    if (!userBehavior) return [];

    const userVector = this.createUserVector(userBehavior);
    const similarities: Array<[string, number]> = [];

    for (const [otherId, otherBehavior] of this.userBehaviors) {
      if (otherId === userId) continue;

      const otherVector = this.createUserVector(otherBehavior);
      const similarity = this.cosineSimilarity(userVector, otherVector);

      if (similarity > 0) {
        similarities.push([otherId, similarity]);
      }
    }

    return similarities.sort((a, b) => b[1] - a[1]).slice(0, limit);
  }

  /**
   * Get hybrid recommendations (content + collaborative)
   */
  async getHybridRecommendations(
    userId: string,
    candidateItems: RecommendationItem[],
    limit: number = 10,
    contentWeight: number = 0.6
  ): Promise<RecommendationItem[]> {
    const contentRecs = await this.getContentBasedRecommendations(userId, candidateItems, limit * 2);
    const collaborativeRecs = await this.getCollaborativeRecommendations(userId, candidateItems, limit * 2);

    // Combine scores
    const combinedScores: Map<string, number> = new Map();

    contentRecs.forEach(item => {
      combinedScores.set(item.id, item.score * contentWeight);
    });

    collaborativeRecs.forEach(item => {
      const currentScore = combinedScores.get(item.id) || 0;
      combinedScores.set(item.id, currentScore + item.score * (1 - contentWeight));
    });

    // Score all items
    const scoredItems = candidateItems.map(item => ({
      ...item,
      score: combinedScores.get(item.id) || 0,
    }));

    return scoredItems.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Get trending items (time-decay weighted popularity)
   */
  async getTrendingItems(
    candidateItems: RecommendationItem[],
    hoursWindow: number = 24,
    limit: number = 10
  ): Promise<RecommendationItem[]> {
    const now = Date.now();
    const windowMs = hoursWindow * 60 * 60 * 1000;
    const itemScores: Map<string, number> = new Map();

    // Calculate popularity with time decay
    for (const behavior of this.userBehaviors.values()) {
      for (const interaction of behavior.interactions) {
        if (now - interaction.timestamp > windowMs) continue;

        const age = (now - interaction.timestamp) / windowMs;
        const decay = Math.exp(-3 * age); // Exponential decay

        const weight = {
          view: 1,
          like: 3,
          share: 5,
          generate: 7,
          search: 2,
        }[interaction.type];

        const currentScore = itemScores.get(interaction.itemId) || 0;
        itemScores.set(interaction.itemId, currentScore + weight * decay);
      }
    }

    // Score candidate items
    const scoredItems = candidateItems.map(item => ({
      ...item,
      score: itemScores.get(item.id) || 0,
    }));

    return scoredItems.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Get personalized trending (hybrid of trending + personalization)
   */
  async getPersonalizedTrending(
    userId: string,
    candidateItems: RecommendationItem[],
    limit: number = 10
  ): Promise<RecommendationItem[]> {
    const trending = await this.getTrendingItems(candidateItems, 24, limit * 2);
    const personalized = await this.getHybridRecommendations(userId, trending, limit);

    return personalized;
  }

  /**
   * Export user behavior for analysis
   */
  exportUserBehavior(userId: string): UserBehavior | null {
    return this.userBehaviors.get(userId) || null;
  }

  /**
   * Clear old data
   */
  clearOldData(daysOld: number = 90): void {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;

    for (const [userId, behavior] of this.userBehaviors) {
      behavior.interactions = behavior.interactions.filter(
        i => i.timestamp > cutoff
      );

      if (behavior.interactions.length === 0) {
        this.userBehaviors.delete(userId);
      }
    }
  }
}

// Singleton instance
let mlEngineInstance: MLRecommendationEngine | null = null;

export function getMLRecommendationEngine(): MLRecommendationEngine {
  if (!mlEngineInstance) {
    mlEngineInstance = new MLRecommendationEngine();
  }
  return mlEngineInstance;
}
