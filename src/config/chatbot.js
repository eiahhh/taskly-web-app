
import express from "express";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch"; // or native fetch if Node 18+

const app = express();
app.use(express.json());

// Supabase setup
const supabase = createClient(
  "YOUR_SUPABASE_URL",
  "YOUR_SUPABASE_ANON_KEY"
);

// Gemini AI API key
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// AI summary endpoint
app.get("/tasks/summary", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Fetch today's tasks
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("title, description, due_date")
      .eq("due_date", today);

    if (error) throw error;
    if (!tasks || tasks.length === 0) return res.json({ summary: "No tasks for today." });

    // Prepare prompt
    const tasksText = tasks.map(t => `- ${t.title}: ${t.description}`).join("\n");
    const prompt = `Summarize the following tasks for today in a concise and friendly way:\n${tasksText}`;

    // Call Gemini AI
    const response = await fetch("https://api.generativeai.google/v1beta2/models/text-bison-001:generateText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: prompt,
        temperature: 0.5,
        maxOutputTokens: 200
      }),
    });

    const data = await response.json();
    const summary = data?.candidates?.[0]?.content || "No summary generated.";

    res.json({ summary });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
