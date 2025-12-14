require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Supabase with service role for RAG data retrieval
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ============================================
// API CONFIG
// ============================================
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// ============================================
// RAG CHATBOT ENDPOINT
// ============================================
app.post('/api/ai/chat', async (req, res) => {
  const { message, userId } = req.body;

  console.log('\n' + '='.repeat(60));
  console.log('💬 User said:', message);
  console.log('👤 User ID:', userId ? userId.substring(0, 8) + '...' : 'none');

  try {
    let prompt;

    // If we have a userId, use RAG (retrieve user data)
    if (userId) {
      console.log('📥 Retrieving user data for RAG...');
      const userData = await retrieveUserData(userId);
      prompt = buildRAGPrompt(message, userData);
    } else {
      // No user ID, use simple prompt
      prompt = `You are a helpful AI assistant. Keep responses concise.\n\nUser: ${message}\n\nAssistant:`;
    }

    // Call Gemini API
    const aiResponse = await callGemini(prompt);
    
    console.log('🤖 AI responded:', aiResponse.substring(0, 60) + '...');

    // Save conversation to history (if userId provided)
    if (userId) {
      await saveConversation(userId, message, aiResponse);
    }

    console.log('✅ Complete!');
    console.log('='.repeat(60) + '\n');

    res.json({ response: aiResponse });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('='.repeat(60) + '\n');
    
    res.json({ 
      response: "I'm having trouble right now. Please try again in a moment." 
    });
  }
});

// ============================================
// RAG: RETRIEVE USER DATA
// ============================================
async function retrieveUserData(userId) {
  console.log('  📋 Fetching profile...');
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  console.log('  📋 Fetching tasks...');
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('datetime', { ascending: true });

  console.log('  📋 Fetching statistics...');
  const { data: stats, error: statsError } = await supabase
    .from('user_statistics')
    .select('*')
    .eq('user_id', userId)
    .single();

  console.log('  📋 Fetching activity...');
  const { data: activity, error: activityError } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('  ✅ Data retrieved!');

  return {
    profile: profile || {},
    tasks: tasks || [],
    stats: stats || {},
    activity: activity || []
  };
}

// ============================================
// RAG: BUILD PROMPT WITH USER DATA
// ============================================
function buildRAGPrompt(userMessage, userData) {
  const { profile, tasks, stats, activity } = userData;
  
  const now = new Date();
  const today = now.toDateString();

  // Process tasks
  const todayTasks = tasks.filter(t => 
    t.datetime && new Date(t.datetime).toDateString() === today && !t.completed
  );
  
  const overdueTasks = tasks.filter(t => 
    t.datetime && new Date(t.datetime) < now && !t.completed
  );
  
  const upcomingTasks = tasks.filter(t => 
    t.datetime && new Date(t.datetime) > now && !t.completed
  ).slice(0, 5);

  const completedTasks = tasks.filter(t => t.completed);
  const incompleteTasks = tasks.filter(t => !t.completed);

  const highPriorityTasks = incompleteTasks.filter(t => 
    t.priority === 'High' || t.priority === 'Urgent'
  );

  // Build context prompt
  let prompt = `You are Taskly AI, a helpful task management assistant with access to the user's real data.

USER INFO:
- Name: ${profile?.full_name || 'User'}
- Total Tasks: ${tasks.length}
- Completed: ${completedTasks.length}
- Incomplete: ${incompleteTasks.length}
- Current Streak: ${stats?.current_streak_days || 0} days
- All-Time Completed: ${stats?.tasks_completed_total || 0}

`;

  // Add today's tasks
  if (todayTasks.length > 0) {
    prompt += `TODAY'S TASKS (${todayTasks.length}):\n`;
    todayTasks.forEach((t, i) => {
      const time = t.datetime ? new Date(t.datetime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'No time';
      prompt += `${i + 1}. "${t.title}" - ${t.priority} priority, ${time}\n`;
    });
    prompt += '\n';
  }

  // Add overdue tasks
  if (overdueTasks.length > 0) {
    prompt += `⚠️ OVERDUE TASKS (${overdueTasks.length}):\n`;
    overdueTasks.slice(0, 3).forEach((t, i) => {
      const days = Math.floor((now - new Date(t.datetime)) / (1000 * 60 * 60 * 24));
      prompt += `${i + 1}. "${t.title}" - ${days} days overdue, ${t.priority}\n`;
    });
    prompt += '\n';
  }

  // Add high priority tasks
  if (highPriorityTasks.length > 0) {
    prompt += `🔴 HIGH PRIORITY (${highPriorityTasks.length}):\n`;
    highPriorityTasks.slice(0, 3).forEach((t, i) => {
      prompt += `${i + 1}. "${t.title}" - ${t.priority}\n`;
    });
    prompt += '\n';
  }

  // Add upcoming tasks
  if (upcomingTasks.length > 0) {
    prompt += `📅 UPCOMING (${upcomingTasks.length}):\n`;
    upcomingTasks.forEach((t, i) => {
      const date = new Date(t.datetime);
      prompt += `${i + 1}. "${t.title}" - ${date.toLocaleDateString()}, ${t.priority}\n`;
    });
    prompt += '\n';
  }

  // Add recent activity
  if (activity.length > 0) {
    prompt += `RECENT ACTIVITY:\n`;
    activity.forEach((a, i) => {
      prompt += `${i + 1}. ${a.description}\n`;
    });
    prompt += '\n';
  }

  prompt += `USER MESSAGE: "${userMessage}"

INSTRUCTIONS:
- Answer based on their ACTUAL data shown above
- Be conversational, friendly, and helpful
- Reference specific tasks when relevant
- Keep responses concise (2-4 sentences unless more detail needed)
- Use natural language

RESPONSE:`;

  return prompt;
}

// ============================================
// SAVE CONVERSATION TO HISTORY
// ============================================
async function saveConversation(userId, message, response) {
  try {
    await supabase
      .from('conversation_history')
      .insert({
        user_id: userId,
        message: message,
        response: response
      });
    console.log('  💾 Saved to history');
  } catch (error) {
    console.log('  ⚠️ Could not save to history:', error.message);
  }
}

// ============================================
// GEMINI API FUNCTION
// ============================================
async function callGemini(userMessage) {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found');
  }

  // Working Gemini 2.x models
  const models = [
    { name: 'gemini-2.5-flash', version: 'v1beta' }
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/${model.version}/models/${model.name}:generateContent?key=${apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: userMessage }]
          }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800,
            topP: 0.95,
            topK: 40
          }
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`  ❌ ${model.name} failed:`, errorText.substring(0, 80));
        lastError = new Error(errorText);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.log(`  ❌ ${model.name} returned empty`);
        continue;
      }

      console.log(`  ✅ ${model.name} worked!`);
      return text;

    } catch (error) {
      console.log(`  ❌ ${model.name} error:`, error.message);
      lastError = error;
      continue;
    }
  }

  throw new Error(`All models failed. Last error: ${lastError?.message}`);
}

// ============================================
// TEST ENDPOINT
// ============================================
app.get('/api/test', async (req, res) => {
  console.log('\n🧪 Testing Gemini...\n');

  try {
    const response = await callGemini('Say hello in a friendly way!');
    
    res.json({
      success: true,
      message: response
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// HTML ROUTES
// ============================================
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'register.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'resetPassword.html'));
});

app.get('/update-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'updatePassword.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'dashboard.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'profile.html'));
});

app.get('/tasks', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'tasks.html'));
});

app.get('/ai-assistant', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'Project', 'ai-assistant.html'));
});

app.get('/', (req, res) => {
  res.redirect('/login');
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🤖 RAG-POWERED CHATBOT SERVER');
  console.log('='.repeat(60));
  console.log(`✅ Running: http://localhost:${PORT}`);
  console.log(`🤖 Gemini: ${process.env.GEMINI_API_KEY ? '✅' : '❌ MISSING'}`);
  console.log(`🗄️  Supabase: ${process.env.SUPABASE_URL ? '✅' : '❌ MISSING'}`);
  console.log(`📝 Test: http://localhost:${PORT}/api/test`);
  console.log('='.repeat(60) + '\n');
});