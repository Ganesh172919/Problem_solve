/**
 * Gamification System
 *
 * User engagement through game mechanics:
 * - Achievement system
 * - Points and levels
 * - Leaderboards
 * - Badges and rewards
 * - Challenges and quests
 * - Progress tracking
 * - Social competition
 */

import { getLogger } from '@/lib/logger';

const logger = getLogger();

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: 'usage' | 'social' | 'content' | 'milestone';
  points: number;
  badge: string;
  condition: AchievementCondition;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
  unlockedBy: number; // count of users who unlocked
}

export interface AchievementCondition {
  type: 'count' | 'streak' | 'threshold' | 'time-based' | 'special';
  metric: string;
  target: number;
  timeframe?: number; // days
}

export interface UserProgress {
  userId: string;
  level: number;
  totalPoints: number;
  pointsToNextLevel: number;
  achievements: UnlockedAchievement[];
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: Date;
  badges: string[];
  rank: number;
}

export interface UnlockedAchievement {
  achievementId: string;
  unlockedAt: Date;
  notified: boolean;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  duration: number; // days
  reward: {
    points: number;
    badge?: string;
    unlocks?: string[];
  };
  requirements: ChallengeRequirement[];
  active: boolean;
  startDate: Date;
  endDate: Date;
  participants: number;
  completions: number;
}

export interface ChallengeRequirement {
  type: string;
  description: string;
  target: number;
  progress?: number;
}

export interface Leaderboard {
  id: string;
  name: string;
  period: 'daily' | 'weekly' | 'monthly' | 'all-time';
  metric: 'points' | 'achievements' | 'streak' | 'custom';
  entries: LeaderboardEntry[];
  lastUpdated: Date;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
  badge?: string;
  level: number;
}

class GamificationSystem {
  private achievements: Map<string, Achievement> = new Map();
  private userProgress: Map<string, UserProgress> = new Map();
  private challenges: Map<string, Challenge> = new Map();
  private leaderboards: Map<string, Leaderboard> = new Map();
  private levelThresholds = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000];

  constructor() {
    this.initializeAchievements();
    this.initializeChallenges();
    this.initializeLeaderboards();
  }

  /**
   * Track user activity
   */
  async trackActivity(userId: string, activityType: string, metadata?: Record<string, any>): Promise<void> {
    let progress = this.userProgress.get(userId);

    if (!progress) {
      progress = this.initializeUserProgress(userId);
    }

    // Update streak
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastActivity = new Date(progress.lastActivityDate);
    lastActivity.setHours(0, 0, 0, 0);

    const daysSinceLastActivity = Math.floor(
      (today.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceLastActivity === 1) {
      progress.currentStreak++;
      progress.longestStreak = Math.max(progress.longestStreak, progress.currentStreak);
    } else if (daysSinceLastActivity > 1) {
      progress.currentStreak = 1;
    }

    progress.lastActivityDate = new Date();

    // Check for achievement unlocks
    await this.checkAchievements(userId, activityType, metadata);

    // Award activity points
    const points = this.calculateActivityPoints(activityType);
    await this.awardPoints(userId, points, `Activity: ${activityType}`);

    this.userProgress.set(userId, progress);

    logger.debug('Activity tracked', {
      userId,
      activityType,
      points,
      streak: progress.currentStreak,
    });
  }

  /**
   * Award points to user
   */
  async awardPoints(userId: string, points: number, reason: string): Promise<void> {
    let progress = this.userProgress.get(userId);

    if (!progress) {
      progress = this.initializeUserProgress(userId);
    }

    const previousLevel = progress.level;
    progress.totalPoints += points;

    // Check for level up
    const newLevel = this.calculateLevel(progress.totalPoints);

    if (newLevel > previousLevel) {
      progress.level = newLevel;
      logger.info('User leveled up', {
        userId,
        level: newLevel,
        totalPoints: progress.totalPoints,
      });

      // Award level-up bonus
      const bonus = newLevel * 10;
      progress.totalPoints += bonus;
    }

    progress.pointsToNextLevel = this.getPointsToNextLevel(progress.totalPoints);

    this.userProgress.set(userId, progress);

    // Update leaderboards
    await this.updateLeaderboards();

    logger.info('Points awarded', { userId, points, reason });
  }

  /**
   * Get user progress
   */
  getUserProgress(userId: string): UserProgress | null {
    return this.userProgress.get(userId) || null;
  }

  /**
   * Get leaderboard
   */
  getLeaderboard(leaderboardId: string): Leaderboard | null {
    return this.leaderboards.get(leaderboardId) || null;
  }

  /**
   * Get active challenges
   */
  getActiveChallenges(): Challenge[] {
    return Array.from(this.challenges.values())
      .filter(c => c.active && new Date() <= c.endDate);
  }

  /**
   * Join challenge
   */
  async joinChallenge(userId: string, challengeId: string): Promise<boolean> {
    const challenge = this.challenges.get(challengeId);

    if (!challenge || !challenge.active) {
      return false;
    }

    challenge.participants++;

    logger.info('User joined challenge', { userId, challengeId });

    return true;
  }

  /**
   * Complete challenge
   */
  async completeChallenge(userId: string, challengeId: string): Promise<void> {
    const challenge = this.challenges.get(challengeId);

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    challenge.completions++;

    // Award rewards
    await this.awardPoints(userId, challenge.reward.points, `Challenge: ${challenge.name}`);

    if (challenge.reward.badge) {
      await this.awardBadge(userId, challenge.reward.badge);
    }

    logger.info('Challenge completed', { userId, challengeId, points: challenge.reward.points });
  }

  /**
   * Get statistics
   */
  getStatistics(): GamificationStatistics {
    const activeUsers = this.userProgress.size;

    const avgLevel = Array.from(this.userProgress.values())
      .reduce((sum, p) => sum + p.level, 0) / (activeUsers || 1);

    const totalAchievements = this.achievements.size;
    const totalUnlocked = Array.from(this.userProgress.values())
      .reduce((sum, p) => sum + p.achievements.length, 0);

    const avgAchievements = totalUnlocked / (activeUsers || 1);

    const activeChallenges = this.getActiveChallenges().length;

    return {
      activeUsers,
      averageLevel: Math.round(avgLevel * 10) / 10,
      totalAchievements,
      averageAchievementsPerUser: Math.round(avgAchievements * 10) / 10,
      activeChallenges,
      totalPoints: Array.from(this.userProgress.values())
        .reduce((sum, p) => sum + p.totalPoints, 0),
    };
  }

  /**
   * Check achievements
   */
  private async checkAchievements(
    userId: string,
    activityType: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const progress = this.userProgress.get(userId);

    if (!progress) return;

    for (const achievement of this.achievements.values()) {
      // Skip if already unlocked
      if (progress.achievements.some(a => a.achievementId === achievement.id)) {
        continue;
      }

      // Check condition
      const unlocked = await this.checkAchievementCondition(
        userId,
        achievement.condition,
        activityType,
        metadata
      );

      if (unlocked) {
        await this.unlockAchievement(userId, achievement.id);
      }
    }
  }

  /**
   * Check achievement condition
   */
  private async checkAchievementCondition(
    userId: string,
    condition: AchievementCondition,
    activityType: string,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    const progress = this.userProgress.get(userId);

    if (!progress) return false;

    switch (condition.type) {
      case 'count':
        // Check if metric count reached target
        const count = metadata?.[condition.metric] || 0;
        return count >= condition.target;

      case 'streak':
        return progress.currentStreak >= condition.target;

      case 'threshold':
        return progress.totalPoints >= condition.target;

      case 'time-based':
        const accountAge = (Date.now() - progress.lastActivityDate.getTime()) / (1000 * 60 * 60 * 24);
        return accountAge >= condition.target;

      default:
        return false;
    }
  }

  /**
   * Unlock achievement
   */
  private async unlockAchievement(userId: string, achievementId: string): Promise<void> {
    const progress = this.userProgress.get(userId);
    const achievement = this.achievements.get(achievementId);

    if (!progress || !achievement) return;

    const unlock: UnlockedAchievement = {
      achievementId,
      unlockedAt: new Date(),
      notified: false,
    };

    progress.achievements.push(unlock);
    achievement.unlockedBy++;

    // Award achievement points
    await this.awardPoints(userId, achievement.points, `Achievement: ${achievement.name}`);

    // Award badge
    if (achievement.badge && !progress.badges.includes(achievement.badge)) {
      progress.badges.push(achievement.badge);
    }

    logger.info('Achievement unlocked', {
      userId,
      achievementId,
      name: achievement.name,
      points: achievement.points,
    });
  }

  /**
   * Award badge
   */
  private async awardBadge(userId: string, badge: string): Promise<void> {
    const progress = this.userProgress.get(userId);

    if (!progress) return;

    if (!progress.badges.includes(badge)) {
      progress.badges.push(badge);
      logger.info('Badge awarded', { userId, badge });
    }
  }

  /**
   * Calculate activity points
   */
  private calculateActivityPoints(activityType: string): number {
    const pointsMap: Record<string, number> = {
      login: 5,
      'post-create': 10,
      'api-call': 1,
      'share': 15,
      'comment': 5,
      'like': 2,
    };

    return pointsMap[activityType] || 1;
  }

  /**
   * Calculate level from points
   */
  private calculateLevel(points: number): number {
    for (let i = this.levelThresholds.length - 1; i >= 0; i--) {
      if (points >= this.levelThresholds[i]) {
        return i + 1;
      }
    }
    return 1;
  }

  /**
   * Get points to next level
   */
  private getPointsToNextLevel(currentPoints: number): number {
    const currentLevel = this.calculateLevel(currentPoints);

    if (currentLevel >= this.levelThresholds.length) {
      return 0; // Max level
    }

    return this.levelThresholds[currentLevel] - currentPoints;
  }

  /**
   * Update leaderboards
   */
  private async updateLeaderboards(): Promise<void> {
    for (const leaderboard of this.leaderboards.values()) {
      const entries: LeaderboardEntry[] = Array.from(this.userProgress.values())
        .map(progress => ({
          rank: 0,
          userId: progress.userId,
          username: `User${progress.userId.substring(0, 8)}`,
          score: this.getLeaderboardScore(progress, leaderboard.metric),
          badge: progress.badges[0],
          level: progress.level,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 100)
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      leaderboard.entries = entries;
      leaderboard.lastUpdated = new Date();
    }
  }

  /**
   * Get leaderboard score
   */
  private getLeaderboardScore(progress: UserProgress, metric: string): number {
    switch (metric) {
      case 'points':
        return progress.totalPoints;
      case 'achievements':
        return progress.achievements.length;
      case 'streak':
        return progress.longestStreak;
      default:
        return 0;
    }
  }

  /**
   * Initialize user progress
   */
  private initializeUserProgress(userId: string): UserProgress {
    const progress: UserProgress = {
      userId,
      level: 1,
      totalPoints: 0,
      pointsToNextLevel: this.levelThresholds[1],
      achievements: [],
      currentStreak: 1,
      longestStreak: 1,
      lastActivityDate: new Date(),
      badges: [],
      rank: 0,
    };

    this.userProgress.set(userId, progress);

    return progress;
  }

  /**
   * Initialize achievements
   */
  private initializeAchievements(): void {
    const achievements: Achievement[] = [
      {
        id: 'first-steps',
        name: 'First Steps',
        description: 'Complete your first action',
        category: 'milestone',
        points: 10,
        badge: 'beginner',
        condition: { type: 'count', metric: 'actions', target: 1 },
        rarity: 'common',
        unlockedBy: 0,
      },
      {
        id: 'week-warrior',
        name: 'Week Warrior',
        description: 'Maintain a 7-day streak',
        category: 'usage',
        points: 50,
        badge: 'streak-7',
        condition: { type: 'streak', metric: 'days', target: 7 },
        rarity: 'rare',
        unlockedBy: 0,
      },
      {
        id: 'power-user',
        name: 'Power User',
        description: 'Reach 1000 points',
        category: 'milestone',
        points: 100,
        badge: 'power-user',
        condition: { type: 'threshold', metric: 'points', target: 1000 },
        rarity: 'epic',
        unlockedBy: 0,
      },
    ];

    for (const achievement of achievements) {
      this.achievements.set(achievement.id, achievement);
    }
  }

  /**
   * Initialize challenges
   */
  private initializeChallenges(): void {
    const now = new Date();
    const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const challenges: Challenge[] = [
      {
        id: 'weekly-explorer',
        name: 'Weekly Explorer',
        description: 'Create 5 posts this week',
        difficulty: 'easy',
        duration: 7,
        reward: { points: 100, badge: 'explorer' },
        requirements: [
          { type: 'posts', description: 'Create posts', target: 5 },
        ],
        active: true,
        startDate: now,
        endDate,
        participants: 0,
        completions: 0,
      },
    ];

    for (const challenge of challenges) {
      this.challenges.set(challenge.id, challenge);
    }
  }

  /**
   * Initialize leaderboards
   */
  private initializeLeaderboards(): void {
    const leaderboards: Omit<Leaderboard, 'entries' | 'lastUpdated'>[] = [
      {
        id: 'all-time-points',
        name: 'All-Time Points Leaders',
        period: 'all-time',
        metric: 'points',
      },
      {
        id: 'weekly-points',
        name: 'Weekly Points Leaders',
        period: 'weekly',
        metric: 'points',
      },
    ];

    for (const lb of leaderboards) {
      this.leaderboards.set(lb.id, {
        ...lb,
        entries: [],
        lastUpdated: new Date(),
      });
    }
  }
}

interface GamificationStatistics {
  activeUsers: number;
  averageLevel: number;
  totalAchievements: number;
  averageAchievementsPerUser: number;
  activeChallenges: number;
  totalPoints: number;
}

// Singleton
let gamificationSystem: GamificationSystem;

export function getGamificationSystem(): GamificationSystem {
  if (!gamificationSystem) {
    gamificationSystem = new GamificationSystem();
  }
  return gamificationSystem;
}

export { GamificationSystem };
