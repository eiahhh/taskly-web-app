require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 1. CRITICAL ENVIRONMENT CHECK
// ============================================
console.log('\n🔍 Checking Environment Variables...');
const requiredEnv = ['GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`\n❌ FATAL ERROR: Missing required .env variables: ${missingEnv.join(', ')}`);
  console.error('👉 Please check your .env file and restart the server.\n');
  process.exit(1);
}
console.log('✅ Environment variables valid.');

// ============================================
// 2. INITIALIZE SERVICES
// ============================================
console.log('🔧 Initializing Supabase...');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================
// 3. MIDDLEWARE & STATIC ASSETS
// ============================================
app.use(express.json());

// Serve "public" folder for general assets
app.use(express.static(path.join(__dirname, 'public')));

// CRITICAL: Serve "src" so HTML files can find their specific CSS/JS
app.use('/src', express.static(path.join(__dirname, 'src')));

// ============================================
// 4. ROBUST GEMINI API FUNCTION (THE FIX)
// ============================================
async function callGeminiAPI(prompt) {
  // Use Node.js native fetch (v18+) or fallback to node-fetch
  let fetchFunc = globalThis.fetch;
  if (!fetchFunc) {
    try {
      fetchFunc = (await import('node-fetch')).default;
    } catch (e) {
      throw new Error("Node.js version too old. Please use Node v18+ or install 'node-fetch'.");
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  
  // 👉 HARDCODED SAFE MODEL FOR FREE TIER
  // 'gemini-1.5-flash' is the rolling alias that works best on free tier
  const model = 'gemini-1.5-flash'; 
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800, // Increased slightly for better answers
    }
  };

  try {
    const response = await fetchFunc(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    // Detailed Error Handling
    if (!response.ok) {
      const errorMsg = data.error?.message || response.statusText;
      console.error(`❌ API Error (${response.status}):`, errorMsg);

      if (response.status === 404) {
        throw new Error(`Model '${model}' not found. Your API key might vary. Try checking Google AI Studio.`);
      }
      if (response.status === 429) {
        throw new Error("Rate Limit Exceeded. Please wait a moment.");
      }
      throw new Error(`Gemini API Error: ${errorMsg}`);
    }

    if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
      throw new Error('Gemini response was empty or blocked by safety filters.');
    }

    return data.candidates[0].content.parts[0].text;

  } catch (error) {
    // Pass the error up to be handled by the route
    throw error;
  }
}

// ============================================
// 5. RAG PIPELINE FUNCTIONS (RESTORED)
// ============================================

async function retrieveUserContext(userId) {
  console.log('📥 RETRIEVE: Fetching user data...');
  try {
    // Run queries in parallel for speed
    const [profile, tasks, stats, activity, history] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('user_id', userId).single(),
      supabase.from('tasks').select('*').eq('user_id', userId).order('datetime', { ascending: true }),
      supabase.from('user_statistics').select('*').eq('user_id', userId).single(),
      supabase.from('activity_log').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
      supabase.from('conversation_history').select('message, response, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5)
    ]);

    return {
      profile: profile.data,
      allTasks: tasks.data || [],
      stats: stats.data || {},
      activity: activity.data || [],
      conversationHistory: history.data || []
    };

  } catch (error) {
    console.error('❌ RETRIEVE Error:', error.message);
    return { profile: null, allTasks: [], stats: {}, activity: [], conversationHistory: [] };
  }
}

function augmentContext(retrievedData) {
  console.log('🔧 AUGMENT: Structuring data...');
  const { profile, allTasks, stats, activity, conversationHistory } = retrievedData;
  const now = new Date();
  
  const completedTasks = allTasks.filter(t => t.completed);
  const incompleteTasks = allTasks.filter(t => !t.completed);
  
  // Specific task buckets
  const overdueTasks = incompleteTasks.filter(t => t.datetime && new Date(t.datetime) < now);
  const todayTasks = incompleteTasks.filter(t => t.datetime && new Date(t.datetime).toDateString() === now.toDateString());
  const upcomingTasks = incompleteTasks.filter(t => t.datetime && new Date(t.datetime) > now).slice(0, 5);
  const highPriority = incompleteTasks.filter(t => t.priority === 'High' || t.priority === 'Urgent');

  return {
    userName: profile?.full_name || 'User',
    taskStats: {
        total: allTasks.length,
        completed: completedTasks.length,
        pending: incompleteTasks.length,
        completionRate: allTasks.length > 0 ? Math.round((completedTasks.length / allTasks.length) * 100) : 0
    },
    lists: {
        overdue: overdueTasks,
        today: todayTasks,
        upcoming: upcomingTasks,
        highPriority: highPriority
    },
    history: conversationHistory.reverse(), // Oldest to newest for context
    streak: stats?.current_streak_days || 0
  };
}

function buildRAGPrompt(userMessage, ctx) {
  console.log('📝 GENERATE: Building Prompt...');
  
  let prompt = `You are an AI assistant for Taskly. 
CONTEXT:
- User: ${ctx.userName}
- Streak: ${ctx.streak} days
- Progress: ${ctx.taskStats.completed}/${ctx.taskStats.total} tasks done (${ctx.taskStats.completionRate}%)
`;

  if (ctx.lists.overdue.length > 0) {
    prompt += `\n⚠️ OVERDUE TASKS:\n${ctx.lists.overdue.map(t => `- ${t.title} (Due: ${new Date(t.datetime).toLocaleDateString()})`).join('\n')}`;
  }
  
  if (ctx.lists.today.length > 0) {
    prompt += `\n📅 TODAY'S TASKS:\n${ctx.lists.today.map(t => `- ${t.title} [${t.priority}]`).join('\n')}`;
  } else if (ctx.lists.upcoming.length > 0) {
    prompt += `\n🔮 UPCOMING:\n${ctx.lists.upcoming.map(t => `- ${t.title}`).join('\n')}`;
  }

  if (ctx.history.length > 0) {
    prompt += `\n\nCONVERSATION HISTORY:\n${ctx.history.map(c => `User: ${c.message}\nAI: ${c.response}`).join('\n')}`;
  }

  prompt += `\n\nCURRENT MESSAGE: "${userMessage}"\n\nINSTRUCTIONS: Give a helpful, motivating, concise response based on the data above. If they have overdue tasks, gently remind them.`;
  
  return prompt;
}

// ============================================
// 6. API ROUTES
// ============================================

// --- Config Endpoint ---
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY // Ensure this is in your .env if client needs it
  });
});

// --- Debug Endpoint ---
app.get('/api/test-gemini', async (req, res) => {
  console.log('\n🧪 Testing Gemini connection...');
  try {
    const response = await callGeminiAPI("Reply with 'Connection Successful' and a smiley face.");
    console.log('✅ Test Result:', response);
    res.json({ success: true, message: response });
  } catch (error) {
    console.error('❌ Test Failed:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Main Chat Endpoint ---
app.post('/api/ai/chat', async (req, res) => {
  console.log('\n💬 New Chat Request');
  try {
    const { message, userId } = req.body;
    
    if (!message || !userId) {
      return res.status(400).json({ error: 'Missing message or userId' });
    }

    // 1. Retrieve & Augment
    const rawData = await retrieveUserContext(userId);
    const context = augmentContext(rawData);
    
    // 2. Build Prompt
    const prompt = buildRAGPrompt(message, context);
    
    // 3. Generate Response
    const aiResponse = await callGeminiAPI(prompt);
    
    // 4. Save History (Async - don't wait)
    supabase.from('conversation_history')
      .insert({ user_id: userId, message, response: aiResponse })
      .catch(err => console.error('Failed to save history:', err.message));

    console.log('✅ Response sent to user.');
    res.json({ response: aiResponse });

  } catch (error) {
    console.error('❌ Chat Pipeline Failed:', error.message);
    res.status(500).json({ error: 'I am having trouble processing that right now.' });
  }
});

// --- HTML Routes ---
// Helper to point to src/Project folder
const servePage = (fileName) => (req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'Project', fileName));
};

app.get('/login', servePage('login.html'));
app.get('/register', servePage('register.html'));
app.get('/reset-password', servePage('resetPassword.html'));
app.get('/update-password', servePage('updatePassword.html'));
app.get('/dashboard', servePage('dashboard.html'));
app.get('/profile', servePage('profile.html'));
app.get('/tasks', servePage('tasks.html'));
app.get('/ai-assistant', servePage('ai-assistant.html'));

// Root Redirect
app.get('/', (req, res) => res.redirect('/login'));

// 404 Handler
app.use((req, res) => {
    console.log(`❌ 404: ${req.url}`);
    res.status(404).send('Page Not Found');
});

// ============================================
// 7. START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 SERVER RUNNING on http://localhost:${PORT}`);
  console.log(`👉 Test API: http://localhost:${PORT}/api/test-gemini`);
  console.log(`==================================================\n`);
});