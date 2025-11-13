// app/api/summarize/route.ts
import { NextRequest } from "next/server";

const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  throw new Error("YOUTUBE_API_KEY is missing in .env.local");
}

export async function POST(request: NextRequest) {
  const { url } = await request.json();

  // Extract video ID
  const match = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
  if (!match) {
    return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
  }
  const videoId = match[1];

  try {
    // 1. Get video details
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${API_KEY}`
    );
    const videoData = await videoRes.json();
    if (!videoData.items?.[0]) {
      return Response.json({ error: "Video not found" }, { status: 404 });
    }

    const video = videoData.items[0];
    const title = video.snippet.title;
    const views = parseInt(video.statistics.viewCount).toLocaleString();
    const totalComments = parseInt(video.statistics.commentCount);

    // 2. Get comments (max 100)
    const commentsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&key=${API_KEY}`
    );
    const commentsData = await commentsRes.json();

    const comments = commentsData.items?.map(
      (item: any) => item.snippet.topLevelComment.snippet.textDisplay
    ) || [];

    // 3. High-value filter (simple keywords)
    const highValueKeywords = [
      "best",
      "love",
      "amazing",
      "help",
      "tutorial",
      "fixed",
      "worked",
      "thanks",
      "genius",
      "insane",
      "mind blown",
      "life changing",
    ];

    const highValueComments = comments.filter((c: string) =>
      highValueKeywords.some((kw) => c.toLowerCase().includes(kw))
    );

    const highValueCount = highValueComments.length;
    const highValueRatio = totalComments > 0 ? ((highValueCount / totalComments) * 100).toFixed(1) : "0";

    // 4. Build summary
    const topThemes = highValueComments
      .slice(0, 3)
      .map((c: string) => `• "${c.substring(0, 80)}${c.length > 80 ? "..." : ""}"`)
      .join("\n");

    const summary = `Found ${highValueCount} high-value comments out of ${totalComments} total.

Top themes:
${topThemes || "No strong signals detected."}

Signal: ${highValueRatio}% of comments contain praise, gratitude, or actionable feedback.`;

    return Response.json({
      video: { title },
      stats: {
        totalViews: views,
        totalComments,
        highValueCount,
        highValueRatio: `${highValueRatio}%`,
      },
      summary,
    });
  } catch (error) {
    console.error("YouTube API error:", error);
    return Response.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
