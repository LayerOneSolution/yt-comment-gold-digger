// app/api/summarize/route.ts
import { NextRequest } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY || !process.env.OPENAI_API_KEY) {
  throw new Error("Missing API keys in .env.local");
}

// FAMILY KEYWORDS — PRIORITY 1
const FAMILY_KEYWORDS = [
  "mom", "mother", "dad", "father", "grandma", "grandpa", "grandmother", "grandfather",
  "sister", "brother", "aunt", "uncle", "son", "daughter", "husband", "wife",
  "friend", "best friend", "neighbor", "cousin"
];

export async function POST(request: NextRequest) {
  const { url } = await request.json();

  const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
  if (!match) return Response.json({ error: "Invalid URL" }, { status: 400 });
  const videoId = match[1];

  try {
    const [videoRes, commentsRes] = await Promise.all([
      fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`
      ),
      fetch(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&key=${API_KEY}`
      ),
    ]);

    const [videoData, commentsData] = await Promise.all([
      videoRes.json(),
      commentsRes.json(),
    ]);

    if (!videoData.items?.[0]) {
      return Response.json({ error: "Video not found" }, { status: 404 });
    }

    const video = videoData.items[0];
    const title = video.snippet.title;
    const views = parseInt(video.statistics.viewCount).toLocaleString();
    const totalComments = parseInt(video.statistics.commentCount);

    const comments: string[] = commentsData.items?.map(
      (item: any) => item.snippet.topLevelComment.snippet.textDisplay
    ) || [];

    let topComments = [];
    let anecdotes = [];
    let summary = "No data.";

    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You are a health comment analyst. 
Return ONLY valid JSON (no markdown):
{
  "topComments": [{"text": "...", "sentiment": 5}],
  "anecdotes": [{"story": "...", "stars": 5}],
  "summary": "..."
}
PRIORITIZE comments mentioning family/friends (mom, dad, etc.) — put them first.`,
          },
          {
            role: "user",
            content: `Comments:\n${comments
              .map((c: string, i: number) => `[${i + 1}] ${c}`)
              .join("\n")}`,
          },
        ],
      });

      let raw = completion.choices[0]?.message?.content?.trim() || "";
      raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();

      if (raw) {
        const parsed = JSON.parse(raw);
        topComments = (parsed.topComments || []).slice(0, 20);
        anecdotes = parsed.anecdotes || [];
        summary = parsed.summary || summary;
      }
    } catch (aiError) {
      console.error("OpenAI failed:", aiError);
    }

    // PRIORITIZE FAMILY COMMENTS IN BOTH LISTS
    const prioritizeFamily = (items: any[]) =>
      items.sort((a, b) => {
        const aHasFamily = FAMILY_KEYWORDS.some(kw => a.text.toLowerCase().includes(kw));
        const bHasFamily = FAMILY_KEYWORDS.some(kw => b.text.toLowerCase().includes(kw));
        if (aHasFamily && !bHasFamily) return -1;
        if (!aHasFamily && bHasFamily) return 1;
        return b.sentiment - a.sentiment; // Then by sentiment
      });

    topComments = prioritizeFamily(topComments);
    anecdotes = prioritizeFamily(anecdotes.map(a => ({ text: a.story, sentiment: a.stars })))
      .map((a, i) => anecdotes[i]); // Restore original object

    const highValueCount = comments.filter((c: string) =>
      /med|pill|dose|stop|reduce|mom|dad|grand|healed|fixed|tea|juice|diet/i.test(c)
    ).length;

    const highValueRatio = totalComments > 0 ? ((highValueCount / totalComments) * 100).toFixed(1) : "0";

    return Response.json({
      video: { title },
      stats: {
        totalViews: views,
        totalComments,
        highValueCount,
        highValueRatio: `${highValueRatio}%`,
      },
      topComments,
      anecdotes,
      summary,
    });
  } catch (error: any) {
    console.error("Error:", error.message);
    return Response.json({ error: "Processing failed" }, { status: 500 });
  }
}
