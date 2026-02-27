/**
 * @module intelligentDataCompressor
 * @description Intelligent data compression engine with adaptive algorithm selection
 * (LZ4/Zstd/Brotli simulation), semantic deduplication, delta encoding, columnar
 * compression for analytics payloads, compression ratio prediction, cost-vs-speed
 * tradeoff optimization, dictionary-based compression for repetitive JSON, content-
 * aware chunking, and compression telemetry for storage cost reduction analytics.
 */

import { getLogger } from './logger';

const logger = getLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type CompressionAlgorithm = 'lz4' | 'zstd' | 'brotli' | 'gzip' | 'snappy' | 'lzma' | 'delta' | 'dictionary' | 'columnar' | 'semantic';
export type CompressionLevel = 'fastest' | 'fast' | 'balanced' | 'best' | 'ultra';
export type DataType = 'json' | 'text' | 'binary' | 'log' | 'metrics' | 'events' | 'media' | 'columnar';
export type CompressionMode = 'streaming' | 'block' | 'chunked' | 'adaptive';

export interface CompressionProfile {
  profileId: string;
  name: string;
  algorithm: CompressionAlgorithm;
  level: CompressionLevel;
  dataType: DataType;
  mode: CompressionMode;
  dictionaryEnabled: boolean;
  deltaEnabled: boolean;
  deduplicationEnabled: boolean;
  expectedRatio: number;         // expected compression ratio (e.g. 3 = 3:1)
  targetSpeedMBps: number;
  createdAt: number;
}

export interface CompressionJob {
  jobId: string;
  profileId: string;
  inputBytes: number;
  outputBytes: number;
  ratio: number;
  algorithm: CompressionAlgorithm;
  level: CompressionLevel;
  durationMs: number;
  speedMBps: number;
  dataType: DataType;
  chunkCount: number;
  deduplicatedBytes: number;
  dictionaryHits: number;
  completedAt: number;
  metadata: Record<string, unknown>;
}

export interface DeltaBlock {
  blockId: string;
  baseBlockId?: string;
  data: string;         // encoded delta or base data
  isDelta: boolean;
  originalSize: number;
  deltaSize: number;
  timestamp: number;
}

export interface CompressionDictionary {
  dictionaryId: string;
  name: string;
  dataType: DataType;
  entries: Record<string, string>;   // pattern -> token
  tokenCount: number;
  hitCount: number;
  missCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface DeduplicationState {
  hashIndex: Map<string, string>;  // hash -> blockId
  totalChunks: number;
  dedupedChunks: number;
  savedBytes: number;
}

export interface CompressionAnalytics {
  totalInputBytes: number;
  totalOutputBytes: number;
  overallRatio: number;
  totalSavedBytes: number;
  estimatedCostSavingUSD: number;
  algorithmBreakdown: Record<CompressionAlgorithm, { jobs: number; avgRatio: number }>;
  dataTypeBreakdown: Record<DataType, { jobs: number; avgRatio: number }>;
  topProfilesByRatio: CompressionProfile[];
}

export interface IntelligentDataCompressorConfig {
  storageCostPerGB?: number;
  defaultChunkSizeBytes?: number;
  maxDictionaryEntries?: number;
  deduplicationEnabled?: boolean;
  adaptiveSelectionEnabled?: boolean;
}

// ── Algorithm Simulation Parameters ──────────────────────────────────────────

const ALGORITHM_PROFILES: Record<CompressionAlgorithm, Record<CompressionLevel, { ratio: number; speedMBps: number }>> = {
  lz4: { fastest: { ratio: 2.0, speedMBps: 4000 }, fast: { ratio: 2.1, speedMBps: 2000 }, balanced: { ratio: 2.3, speedMBps: 800 }, best: { ratio: 2.5, speedMBps: 200 }, ultra: { ratio: 2.6, speedMBps: 100 } },
  zstd: { fastest: { ratio: 2.5, speedMBps: 1500 }, fast: { ratio: 3.0, speedMBps: 600 }, balanced: { ratio: 3.5, speedMBps: 300 }, best: { ratio: 4.0, speedMBps: 100 }, ultra: { ratio: 4.5, speedMBps: 30 } },
  brotli: { fastest: { ratio: 2.8, speedMBps: 300 }, fast: { ratio: 3.5, speedMBps: 100 }, balanced: { ratio: 4.2, speedMBps: 40 }, best: { ratio: 5.0, speedMBps: 10 }, ultra: { ratio: 5.5, speedMBps: 3 } },
  gzip: { fastest: { ratio: 2.2, speedMBps: 400 }, fast: { ratio: 2.6, speedMBps: 200 }, balanced: { ratio: 3.0, speedMBps: 100 }, best: { ratio: 3.4, speedMBps: 40 }, ultra: { ratio: 3.6, speedMBps: 20 } },
  snappy: { fastest: { ratio: 1.8, speedMBps: 5000 }, fast: { ratio: 1.9, speedMBps: 3000 }, balanced: { ratio: 2.0, speedMBps: 1500 }, best: { ratio: 2.1, speedMBps: 800 }, ultra: { ratio: 2.2, speedMBps: 400 } },
  lzma: { fastest: { ratio: 3.5, speedMBps: 50 }, fast: { ratio: 4.0, speedMBps: 30 }, balanced: { ratio: 4.5, speedMBps: 15 }, best: { ratio: 5.5, speedMBps: 5 }, ultra: { ratio: 6.0, speedMBps: 2 } },
  delta: { fastest: { ratio: 5.0, speedMBps: 2000 }, fast: { ratio: 6.0, speedMBps: 1500 }, balanced: { ratio: 7.0, speedMBps: 1000 }, best: { ratio: 8.0, speedMBps: 500 }, ultra: { ratio: 10.0, speedMBps: 200 } },
  dictionary: { fastest: { ratio: 3.0, speedMBps: 3000 }, fast: { ratio: 3.5, speedMBps: 2000 }, balanced: { ratio: 4.0, speedMBps: 1000 }, best: { ratio: 5.0, speedMBps: 400 }, ultra: { ratio: 6.0, speedMBps: 150 } },
  columnar: { fastest: { ratio: 4.0, speedMBps: 2000 }, fast: { ratio: 5.0, speedMBps: 1200 }, balanced: { ratio: 6.0, speedMBps: 600 }, best: { ratio: 7.5, speedMBps: 200 }, ultra: { ratio: 9.0, speedMBps: 80 } },
  semantic: { fastest: { ratio: 6.0, speedMBps: 500 }, fast: { ratio: 8.0, speedMBps: 300 }, balanced: { ratio: 10.0, speedMBps: 150 }, best: { ratio: 12.0, speedMBps: 60 }, ultra: { ratio: 15.0, speedMBps: 20 } },
};

const DATA_TYPE_MULTIPLIERS: Record<DataType, number> = {
  json: 1.4,  text: 1.3, binary: 0.7, log: 1.5, metrics: 1.6, events: 1.4, media: 0.6, columnar: 1.8,
};

// ── Core Class ────────────────────────────────────────────────────────────────

export class IntelligentDataCompressor {
  private profiles = new Map<string, CompressionProfile>();
  private jobs: CompressionJob[] = [];
  private dictionaries = new Map<string, CompressionDictionary>();
  private deltaBlocks = new Map<string, DeltaBlock>();
  private deduplication: DeduplicationState = { hashIndex: new Map(), totalChunks: 0, dedupedChunks: 0, savedBytes: 0 };
  private config: Required<IntelligentDataCompressorConfig>;

  constructor(config: IntelligentDataCompressorConfig = {}) {
    this.config = {
      storageCostPerGB: config.storageCostPerGB ?? 0.023,
      defaultChunkSizeBytes: config.defaultChunkSizeBytes ?? 65_536,
      maxDictionaryEntries: config.maxDictionaryEntries ?? 10_000,
      deduplicationEnabled: config.deduplicationEnabled ?? true,
      adaptiveSelectionEnabled: config.adaptiveSelectionEnabled ?? true,
    };
  }

  // ── Profile Management ─────────────────────────────────────────────────────

  createProfile(params: Omit<CompressionProfile, 'profileId' | 'expectedRatio' | 'createdAt'>): CompressionProfile {
    const algoProfile = ALGORITHM_PROFILES[params.algorithm][params.level];
    const dataMultiplier = DATA_TYPE_MULTIPLIERS[params.dataType];
    const expectedRatio = algoProfile.ratio * dataMultiplier;

    const profile: CompressionProfile = {
      ...params,
      profileId: `profile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      expectedRatio,
      createdAt: Date.now(),
    };

    this.profiles.set(profile.profileId, profile);
    logger.info('Compression profile created', { profileId: profile.profileId, algorithm: profile.algorithm, expectedRatio });
    return profile;
  }

  getProfile(profileId: string): CompressionProfile | undefined {
    return this.profiles.get(profileId);
  }

  // ── Adaptive Algorithm Selection ──────────────────────────────────────────

  selectOptimalAlgorithm(dataType: DataType, sizeBytes: number, constraints: { maxLatencyMs?: number; minRatio?: number } = {}): CompressionAlgorithm {
    if (!this.config.adaptiveSelectionEnabled) return 'zstd';

    const candidates: Array<{ algo: CompressionAlgorithm; level: CompressionLevel; score: number }> = [];

    for (const [algo, levels] of Object.entries(ALGORITHM_PROFILES)) {
      for (const [level, stats] of Object.entries(levels)) {
        const dataMultiplier = DATA_TYPE_MULTIPLIERS[dataType];
        const actualRatio = stats.ratio * dataMultiplier;
        const latencyMs = sizeBytes / (stats.speedMBps * 1024 * 1024) * 1000;

        if (constraints.minRatio && actualRatio < constraints.minRatio) continue;
        if (constraints.maxLatencyMs && latencyMs > constraints.maxLatencyMs) continue;

        // Score = ratio * speed_normalized
        const speedScore = Math.log1p(stats.speedMBps) / Math.log1p(5000);
        const ratioScore = actualRatio / 15;
        candidates.push({ algo: algo as CompressionAlgorithm, level: level as CompressionLevel, score: ratioScore * 0.6 + speedScore * 0.4 });
      }
    }

    if (candidates.length === 0) return 'lz4';
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]!.algo;
  }

  // ── Compression Simulation ────────────────────────────────────────────────

  compress(profileId: string, inputBytes: number, dataType?: DataType): CompressionJob {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Profile ${profileId} not found`);

    const effectiveDataType = dataType ?? profile.dataType;
    const algoStats = ALGORITHM_PROFILES[profile.algorithm][profile.level];
    const dataMultiplier = DATA_TYPE_MULTIPLIERS[effectiveDataType];

    // Compute with slight randomness for realism
    const ratio = algoStats.ratio * dataMultiplier * (0.9 + Math.random() * 0.2);
    const speedMBps = algoStats.speedMBps * (0.8 + Math.random() * 0.4);
    const durationMs = (inputBytes / (1024 * 1024)) / speedMBps * 1000;

    let deduplicatedBytes = 0;
    if (profile.deduplicationEnabled && this.config.deduplicationEnabled) {
      deduplicatedBytes = Math.floor(inputBytes * 0.15 * Math.random()); // ~0-15% dedup savings
    }

    const dictionaryHits = profile.dictionaryEnabled ? Math.floor(inputBytes * 0.1 * Math.random()) : 0;
    const effectiveInputBytes = inputBytes - deduplicatedBytes;
    const outputBytes = Math.max(1, Math.floor(effectiveInputBytes / ratio));
    const chunkCount = Math.ceil(inputBytes / this.config.defaultChunkSizeBytes);

    const job: CompressionJob = {
      jobId: `cjob_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      profileId,
      inputBytes,
      outputBytes,
      ratio: inputBytes / outputBytes,
      algorithm: profile.algorithm,
      level: profile.level,
      durationMs,
      speedMBps,
      dataType: effectiveDataType,
      chunkCount,
      deduplicatedBytes,
      dictionaryHits,
      completedAt: Date.now(),
      metadata: { originalRatio: ratio },
    };

    this.jobs.push(job);
    if (this.jobs.length > 100_000) this.jobs.shift();

    return job;
  }

  // ── Delta Encoding ────────────────────────────────────────────────────────

  createDeltaBlock(baseBlockId: string | undefined, data: string): DeltaBlock {
    const originalSize = data.length;

    let deltaData: string;
    let deltaSize: number;
    let isDelta: boolean;

    if (baseBlockId && this.deltaBlocks.has(baseBlockId)) {
      const base = this.deltaBlocks.get(baseBlockId)!;
      // Simulate delta by finding common prefix
      const baseData = base.data;
      let commonLength = 0;
      for (let i = 0; i < Math.min(baseData.length, data.length); i++) {
        if (baseData[i] !== data[i]) break;
        commonLength++;
      }
      deltaData = `DELTA:skip=${commonLength}&add=${data.slice(commonLength)}`;
      deltaSize = deltaData.length;
      isDelta = deltaSize < originalSize;
    } else {
      deltaData = data;
      deltaSize = originalSize;
      isDelta = false;
    }

    const block: DeltaBlock = {
      blockId: `dblock_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      baseBlockId,
      data: deltaData,
      isDelta,
      originalSize,
      deltaSize,
      timestamp: Date.now(),
    };

    this.deltaBlocks.set(block.blockId, block);
    return block;
  }

  // ── Dictionary Management ─────────────────────────────────────────────────

  buildDictionary(name: string, dataType: DataType, samples: string[]): CompressionDictionary {
    const freq = new Map<string, number>();

    for (const sample of samples) {
      // Extract n-grams of length 3-8
      for (let len = 3; len <= 8; len++) {
        for (let i = 0; i <= sample.length - len; i++) {
          const pattern = sample.slice(i, i + len);
          freq.set(pattern, (freq.get(pattern) ?? 0) + 1);
        }
      }
    }

    // Select top patterns by frequency
    const sorted = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.min(this.config.maxDictionaryEntries, 1000));

    const entries: Record<string, string> = {};
    sorted.forEach(([pattern], i) => {
      entries[pattern] = `\x00${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
    });

    const dict: CompressionDictionary = {
      dictionaryId: `dict_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      dataType,
      entries,
      tokenCount: Object.keys(entries).length,
      hitCount: 0,
      missCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.dictionaries.set(dict.dictionaryId, dict);
    logger.info('Compression dictionary built', { dictionaryId: dict.dictionaryId, entries: dict.tokenCount });
    return dict;
  }

  applyDictionary(dictionaryId: string, data: string): { compressed: string; hitCount: number; ratio: number } {
    const dict = this.dictionaries.get(dictionaryId);
    if (!dict) throw new Error(`Dictionary ${dictionaryId} not found`);

    let compressed = data;
    let hitCount = 0;

    for (const [pattern, token] of Object.entries(dict.entries)) {
      if (compressed.includes(pattern)) {
        compressed = compressed.split(pattern).join(token);
        hitCount++;
        dict.hitCount++;
      } else {
        dict.missCount++;
      }
    }

    dict.updatedAt = Date.now();
    return { compressed, hitCount, ratio: data.length / Math.max(1, compressed.length) };
  }

  // ── Deduplication ─────────────────────────────────────────────────────────

  deduplicateChunk(data: string, chunkId: string): { isDuplicate: boolean; referenceId?: string; savedBytes: number } {
    if (!this.config.deduplicationEnabled) return { isDuplicate: false, savedBytes: 0 };

    // Simple hash using FNV-1a
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const hashStr = (hash >>> 0).toString(16);

    this.deduplication.totalChunks++;

    if (this.deduplication.hashIndex.has(hashStr)) {
      const referenceId = this.deduplication.hashIndex.get(hashStr)!;
      this.deduplication.dedupedChunks++;
      this.deduplication.savedBytes += data.length;
      return { isDuplicate: true, referenceId, savedBytes: data.length };
    }

    this.deduplication.hashIndex.set(hashStr, chunkId);
    return { isDuplicate: false, savedBytes: 0 };
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getAnalytics(): CompressionAnalytics {
    const totalInput = this.jobs.reduce((s, j) => s + j.inputBytes, 0);
    const totalOutput = this.jobs.reduce((s, j) => s + j.outputBytes, 0);
    const savedBytes = totalInput - totalOutput + this.deduplication.savedBytes;
    const savedGB = savedBytes / (1024 * 1024 * 1024);

    const algoBreakdown = {} as CompressionAnalytics['algorithmBreakdown'];
    const typeBreakdown = {} as CompressionAnalytics['dataTypeBreakdown'];

    for (const job of this.jobs) {
      if (!algoBreakdown[job.algorithm]) algoBreakdown[job.algorithm] = { jobs: 0, avgRatio: 0 };
      const a = algoBreakdown[job.algorithm]!;
      a.avgRatio = (a.avgRatio * a.jobs + job.ratio) / (a.jobs + 1);
      a.jobs++;

      if (!typeBreakdown[job.dataType]) typeBreakdown[job.dataType] = { jobs: 0, avgRatio: 0 };
      const t = typeBreakdown[job.dataType]!;
      t.avgRatio = (t.avgRatio * t.jobs + job.ratio) / (t.jobs + 1);
      t.jobs++;
    }

    const topProfiles = Array.from(this.profiles.values())
      .sort((a, b) => b.expectedRatio - a.expectedRatio)
      .slice(0, 5);

    return {
      totalInputBytes: totalInput,
      totalOutputBytes: totalOutput,
      overallRatio: totalOutput > 0 ? totalInput / totalOutput : 1,
      totalSavedBytes: savedBytes,
      estimatedCostSavingUSD: savedGB * this.config.storageCostPerGB,
      algorithmBreakdown: algoBreakdown,
      dataTypeBreakdown: typeBreakdown,
      topProfilesByRatio: topProfiles,
    };
  }

  predictRatio(algorithm: CompressionAlgorithm, level: CompressionLevel, dataType: DataType): number {
    const algoStats = ALGORITHM_PROFILES[algorithm][level];
    const dataMultiplier = DATA_TYPE_MULTIPLIERS[dataType];
    return algoStats.ratio * dataMultiplier;
  }

  getDeduplicationStats(): { totalChunks: number; dedupedChunks: number; dedupRatio: number; savedBytes: number } {
    const { totalChunks, dedupedChunks, savedBytes } = this.deduplication;
    return {
      totalChunks,
      dedupedChunks,
      dedupRatio: totalChunks > 0 ? dedupedChunks / totalChunks : 0,
      savedBytes,
    };
  }

  getDashboardSummary(): Record<string, unknown> {
    const analytics = this.getAnalytics();
    return {
      totalProfiles: this.profiles.size,
      totalJobs: this.jobs.length,
      totalDictionaries: this.dictionaries.size,
      totalDeltaBlocks: this.deltaBlocks.size,
      overallCompressionRatio: analytics.overallRatio,
      totalSavedGB: analytics.totalSavedBytes / (1024 * 1024 * 1024),
      estimatedCostSavingUSD: analytics.estimatedCostSavingUSD,
      deduplicationRatio: this.getDeduplicationStats().dedupRatio,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export function getDataCompressor(): IntelligentDataCompressor {
  const key = '__intelligentDataCompressor__';
  if (!(globalThis as Record<string, unknown>)[key]) {
    (globalThis as Record<string, unknown>)[key] = new IntelligentDataCompressor();
  }
  return (globalThis as Record<string, unknown>)[key] as IntelligentDataCompressor;
}
