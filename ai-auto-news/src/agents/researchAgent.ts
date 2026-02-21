import { ResearchResult } from '@/types';

const PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

const TOPICS = [
  'latest breakthroughs in artificial intelligence',
  'new developments in machine learning research',
  'trending technology startups and innovations',
  'latest advances in large language models',
  'new developments in robotics and automation',
  'cybersecurity threats and solutions trending today',
  'latest developments in quantum computing',
  'new breakthroughs in computer vision and image AI',
  'trending topics in cloud computing and DevOps',
  'latest news in blockchain and Web3 technology',
  'advances in natural language processing',
  'new developments in autonomous vehicles',
  'trending topics in edge computing and IoT',
  'latest updates in AI regulation and ethics',
  'new developments in generative AI applications',
];

function getRandomTopic(recentTopics: string[]): string {
  const recentLower = recentTopics.map((t) => t.toLowerCase());
  const available = TOPICS.filter(
    (t) => !recentLower.some((r) => r.includes(t.substring(0, 20).toLowerCase()))
  );
  const pool = available.length > 0 ? available : TOPICS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export async function researchAgent(recentTopics: string[] = []): Promise<ResearchResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;

  const topic = getRandomTopic(recentTopics);

  // If no API key, return fallback research
  if (!apiKey || apiKey === 'your_perplexity_api_key_here') {
    return generateFallbackResearch(topic);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content:
              'You are a research assistant. Return ONLY valid JSON with no markdown formatting. Research the given topic and return structured data.',
          },
          {
            role: 'user',
            content: `Research the latest news and developments about: "${topic}". 
Return ONLY a JSON object with this exact structure:
{
  "topic": "the main topic",
  "headline": "a compelling headline",
  "summary": "2-3 sentence summary",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4"],
  "references": ["source 1", "source 2"]
}
Return ONLY the JSON object, no markdown, no code blocks.`,
          },
        ],
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Perplexity API error: ${response.status}`);
      return generateFallbackResearch(topic);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return parseResearchResponse(content, topic);
  } catch (error) {
    console.error('Research agent error:', error);
    return generateFallbackResearch(topic);
  }
}

function parseResearchResponse(content: string, fallbackTopic: string): ResearchResult {
  try {
    // Try direct parse
    const parsed = JSON.parse(content);
    return validateResearchResult(parsed);
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateResearchResult(parsed);
      } catch {
        // Fall through
      }
    }
    return generateFallbackResearch(fallbackTopic);
  }
}

function validateResearchResult(data: Record<string, unknown>): ResearchResult {
  return {
    topic: String(data.topic || ''),
    headline: String(data.headline || ''),
    summary: String(data.summary || ''),
    keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints.map(String) : [],
    references: Array.isArray(data.references) ? data.references.map(String) : [],
  };
}

function generateFallbackResearch(topic: string): ResearchResult {
  const headlines: Record<string, string> = {
    'latest breakthroughs in artificial intelligence':
      'AI Continues to Transform Industries with Groundbreaking New Capabilities',
    'new developments in machine learning research':
      'Machine Learning Research Pushes Boundaries of What AI Can Achieve',
    'trending technology startups and innovations':
      'Tech Startups Driving Innovation Across Multiple Sectors',
    'latest advances in large language models':
      'Large Language Models Reach New Milestones in Understanding and Generation',
    'new developments in robotics and automation':
      'Robotics Industry Sees Rapid Advancement in Autonomous Systems',
    'cybersecurity threats and solutions trending today':
      'Cybersecurity Landscape Evolves with New AI-Powered Defense Mechanisms',
    'latest developments in quantum computing':
      'Quantum Computing Advances Move Closer to Practical Applications',
    'new breakthroughs in computer vision and image AI':
      'Computer Vision AI Achieves Unprecedented Accuracy in Real-World Applications',
    'trending topics in cloud computing and DevOps':
      'Cloud Computing Trends Reshape Enterprise Infrastructure Strategies',
    'latest news in blockchain and Web3 technology':
      'Blockchain Technology Finds New Applications Beyond Cryptocurrency',
    'advances in natural language processing':
      'NLP Breakthroughs Enable More Natural Human-Computer Interaction',
    'new developments in autonomous vehicles':
      'Autonomous Vehicle Technology Reaches New Safety and Performance Milestones',
    'trending topics in edge computing and IoT':
      'Edge Computing and IoT Converge to Create Smarter Connected Systems',
    'latest updates in AI regulation and ethics':
      'Global AI Regulation Frameworks Take Shape as Ethics Debates Intensify',
    'new developments in generative AI applications':
      'Generative AI Applications Expand into New Creative and Business Domains',
  };

  const headline = headlines[topic] || `Latest Developments in ${topic}`;

  return {
    topic,
    headline,
    summary: `Recent developments in ${topic} continue to reshape the technology landscape. Industry experts highlight significant progress and emerging trends that promise to impact businesses and consumers alike. Multiple organizations are investing heavily in this space.`,
    keyPoints: [
      `Significant advancements have been made in ${topic} over recent months`,
      'Industry leaders are increasing investment in research and development',
      'New practical applications are emerging for enterprise and consumer use',
      'Regulatory frameworks are evolving to keep pace with rapid innovation',
    ],
    references: [
      'Technology industry reports and analysis',
      'Recent academic publications and research papers',
    ],
  };
}
