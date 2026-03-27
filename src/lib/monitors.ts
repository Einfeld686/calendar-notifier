import type { SourceMonitor } from "../types.js";

export interface MonitorSeed {
  slug: string;
  brand: SourceMonitor["brand"];
  eventType: SourceMonitor["eventType"];
  strategy: SourceMonitor["strategy"];
  seedUrls: string[];
  allowedDomains: string[];
  requiresManualReview: boolean;
  liteDefault: boolean;
  crawlDelaySeconds: number;
  maxRetries: number;
  retryBackoffSeconds: number[];
  respectRobots: boolean;
  enabled: boolean;
}

export const monitorSeeds: MonitorSeed[] = [
  {
    slug: "muji-ryohin-week",
    brand: "muji",
    eventType: "muji_ryohin_week",
    strategy: "static_page",
    seedUrls: ["https://www.muji.com/jp/ja/special-feature/ryohinweek/"],
    allowedDomains: ["muji.com"],
    requiresManualReview: false,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "rakuten-thanks-day",
    brand: "rakuten",
    eventType: "rakuten_thanks_day",
    strategy: "rule",
    seedUrls: ["https://event.rakuten.co.jp/campaign/rank/point/"],
    allowedDomains: ["rakuten.co.jp"],
    requiresManualReview: false,
    liteDefault: false,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "rakuten-marathon",
    brand: "rakuten",
    eventType: "rakuten_marathon",
    strategy: "static_page",
    seedUrls: ["https://event.rakuten.co.jp/campaign/point-up/marathon/"],
    allowedDomains: ["rakuten.co.jp"],
    requiresManualReview: false,
    liteDefault: false,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "rakuten-super-sale",
    brand: "rakuten",
    eventType: "rakuten_super_sale",
    strategy: "seeded_discovery",
    seedUrls: ["https://event.rakuten.co.jp/campaign/supersale/"],
    allowedDomains: ["rakuten.co.jp"],
    requiresManualReview: true,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "amazon-prime-day",
    brand: "amazon",
    eventType: "amazon_prime_day",
    strategy: "seeded_discovery",
    seedUrls: ["https://www.amazon.co.jp/primeday"],
    allowedDomains: ["amazon.co.jp"],
    requiresManualReview: true,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "amazon-prime-thanks-festival",
    brand: "amazon",
    eventType: "amazon_prime_thanks_festival",
    strategy: "seeded_discovery",
    seedUrls: ["https://www.amazon.co.jp/events/primethanks"],
    allowedDomains: ["amazon.co.jp"],
    requiresManualReview: true,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
  {
    slug: "amazon-black-friday",
    brand: "amazon",
    eventType: "amazon_black_friday",
    strategy: "seeded_discovery",
    seedUrls: ["https://www.amazon.co.jp/blackfriday"],
    allowedDomains: ["amazon.co.jp"],
    requiresManualReview: true,
    liteDefault: true,
    crawlDelaySeconds: 10,
    maxRetries: 3,
    retryBackoffSeconds: [60, 300, 900],
    respectRobots: true,
    enabled: true,
  },
];
