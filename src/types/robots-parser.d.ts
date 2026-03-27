declare module "robots-parser" {
  export interface RobotsParserInstance {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
  }

  export default function robotsParser(url: string, contents: string): RobotsParserInstance;
}
