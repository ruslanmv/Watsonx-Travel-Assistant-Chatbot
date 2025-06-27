// server.js
const express = require('express');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Watson credentials
const { API_KEY, PROJECT_ID, MODEL_ID, EMBEDDING_MODEL_ID } = process.env; // MODEL_ID = default text model
// You'll need to add EMBEDDING_MODEL_ID to your .env file
// e.g., EMBEDDING_MODEL_ID=ibm/slate-30m-english-rtrvr-v2 (check Watsonx for available models)

// --- Simulated In-Memory Databases ---
const simulatedUsersDB = [
    {
        id: "user_benson",
        name: "Benson",
        preferences: {
            travelStyle: "adventure",
            budget: "mid-range",
            preferredActivities: ["hiking", "photography", "exploring local markets"]
        },
        allergies: ["peanuts"],
        phobias: ["heights (mild)"],
        captionPreferences: { defaultTone: "witty", commonHashtags: ["#BensonAdventures", "#travelgram"] }
    },
    {
        id: "user_victory",
        name: "Victory",
        preferences: {
            travelStyle: "relaxing",
            budget: "luxury",
            preferredActivities: ["beach lounging", "spa treatments", "fine dining"]
        },
        allergies: ["shellfish"],
        phobias: ["spiders"],
        captionPreferences: { defaultTone: "elegant", commonHashtags: ["#LuxuryTravel", "#VicVibes"] }
    },
    {
        id: "user_friend1_sam",
        name: "Sam",
        preferences: {
            travelStyle: "cultural",
            budget: "budget",
            preferredActivities: ["museums", "historical sites", "local festivals"]
        },
        allergies: ["gluten (intolerance)"],
        phobias: ["claustrophobia"],
        captionPreferences: { defaultTone: "informative", commonHashtags: ["#CultureTrip", "#HistoryBuff"] }
    },
    {
        id: "user_friend2_alex",
        name: "Alex",
        preferences: {
            travelStyle: "foodie",
            budget: "mid-range",
            preferredActivities: ["cooking classes", "food tours", " Michelin-starred restaurants"]
        },
        allergies: ["dairy"],
        phobias: ["snakes"],
        captionPreferences: { defaultTone: "enthusiastic", commonHashtags: ["#FoodieTravels", "#EatWorld"] }
    },
    {
        id: "user_friend3_jamie",
        name: "Jamie",
        preferences: {
            travelStyle: "nature",
            budget: "any",
            preferredActivities: ["wildlife spotting", "national parks", "stargazing"]
        },
        allergies: ["pollen (hay fever)"],
        phobias: ["deep water"],
        captionPreferences: { defaultTone: "serene", commonHashtags: ["#NatureLover", "#Wilderness"] }
    }
];

// For RAG - Q&A
const tinyVectorStoreDB = [
    { id: "tip1", text: "For budget travel in Southeast Asia, consider local buses and street food for authentic experiences.", embedding: null },
    { id: "tip2", text: "When visiting European capitals, purchase a city pass online beforehand for discounts on museum access and public transport.", embedding: null },
    { id: "tip3", text: "Always pack a universal adapter and a portable power bank for international trips to keep your devices charged.", embedding: null },
    { id: "tip4", text: "Learn a few basic phrases in the local language; it can greatly enhance your interactions and show respect for the culture.", embedding: null },
    { id: "tip5", text: "Stay hydrated, especially in hot climates or when doing a lot of walking. Carry a reusable water bottle.", embedding: null }
];

// For Itineraries - Mock POIs
const mockItineraryData = {
    "Paris": {
        adventure: ["Seine river kayaking expedition", "Urban exploration cycling tour"],
        cultural: ["Guided tour of the Louvre Museum", "Evening at Montmartre watching artists"],
        relaxing: ["Picnic in Luxembourg Gardens", "Bateaux Mouches scenic river cruise"],
        foodie: ["Le Marais food tour", "Wine and cheese tasting workshop"],
        nature: ["Walk in Bois de Boulogne", "Visit Parc des Buttes-Chaumont"]
    },
    "Bali": {
        adventure: ["Mount Batur sunrise volcano hike", "White water rafting on Ayung River"],
        cultural: ["Visit to Tanah Lot temple for sunset", "Traditional Kecak dance performance in Ubud"],
        relaxing: ["Yoga and meditation retreat in Sidemen", "Seminyak beach club lounging"],
        foodie: ["Balinese cooking class in a traditional village", "Seafood BBQ dinner at Jimbaran Bay"],
        nature: ["Tegalalang Rice Paddies exploration", "Visit to the Sekumpul Waterfall"]
    },
    // Add 1-2 more destinations if you have time
};

// --- End Simulated Databases ---


/* ── express setup ── */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json()); // To parse JSON bodies if needed for other routes
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded bodies


/* ── file upload (memory) ── */
// Allow multiple file types: image, document, video. For demo, we'll mainly focus on image.
const upload = multer({ storage: multer.memoryStorage() }).fields([
    { name: 'image', maxCount: 5 }, // Allow up to 5 images for memory capsules
    { name: 'document', maxCount: 1 },
    { name: 'video', maxCount: 1 } // Though processing video is out of scope for quick demo
]);


/* ── token cache ── */
let cachedToken = null, tokenExpiry = 0;
async function getIamToken() {
  // ... (your existing getIamToken function is good)
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const params = new URLSearchParams({
    grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
    apikey: API_KEY
  });
  const { data } = await axios.post(
    'https://iam.cloud.ibm.com/identity/token',
    params,
    { headers:{ 'Content-Type':'application/x-www-form-urlencoded' } }
  );
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 60s buffer
  return cachedToken;
}

// --- Helper: Watsonx LLM Call ---
async function callWatsonxLlm(messages, modelIdOverride, maxTokens = 300) {
  const token = await getIamToken();
  const pickedModel = modelIdOverride || MODEL_ID; // Use override or default text model
  
  // Ensure the messages array doesn't have empty user content if only image was sent
  // or if the last message is a system message with no user input following.
  const lastMessage = messages[messages.length - 1];
  if (messages.length > 1 && lastMessage.role === 'user' && !lastMessage.content) {
      // This can happen if a user tries to send a blank message.
      // Or if logic error leads to empty content.
      // For vision models, content can be an array. For text, it's a string.
      // We'll assume if content is empty, it's an error or needs a placeholder.
      // For now, let's prevent this call if user content is truly empty.
      if (Array.isArray(lastMessage.content) && lastMessage.content.every(c => !c.text && !c.image_url)) {
           throw new Error("User message content is empty.");
      } else if (typeof lastMessage.content === 'string' && !lastMessage.content.trim()) {
           throw new Error("User message content is empty.");
      }
  }


  console.log(`Calling Watsonx LLM: ${pickedModel} with messages:`, JSON.stringify(messages, null, 2));

  const { data } = await axios.post(
      'https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2023-05-29', // Ensure this is your correct regional endpoint
      {
          project_id: PROJECT_ID,
          model_id: pickedModel,
          messages: messages,
          parameters: { // Added parameters object
              decoding_method: "greedy", // Or "sample" for more creative
              max_new_tokens: maxTokens,
              min_new_tokens: 10,
              // repetition_penalty: 1.05 // Optional
          }
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
  );
  return data?.choices?.[0]?.message?.content || '🤖 No reply from LLM.';
}

// --- Helper: Watsonx Embedding Call ---
async function getEmbedding(textInput) {
  if (!EMBEDDING_MODEL_ID) {
      console.warn("EMBEDDING_MODEL_ID not set. Skipping embedding.");
      return null;
  }
  const token = await getIamToken();
  console.log(`Getting embedding for: "${textInput}" using ${EMBEDDING_MODEL_ID}`);
  try {
      const { data } = await axios.post(
          `https://us-south.ml.cloud.ibm.com/ml/v1/text/embeddings?version=2023-11-22`, // Ensure this version is current or matches your model's requirements
          {
              project_id: PROJECT_ID,
              model_id: EMBEDDING_MODEL_ID,
              inputs: [textInput] // Corrected: API expects 'inputs' (plural)
          },
          { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
      );
      return data?.results?.[0]?.embedding || null;
  } catch (err) {
      console.error("Watsonx Embedding API error:", err.response?.data || err.message);
      return null;
  }
}

// --- Helper: Cosine Similarity ---
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
  }
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dotProduct / (magnitudeA * magnitudeB);
}

// --- Initialize Tiny Vector Store Embeddings (once on server start) ---
async function initializeVectorStore() {
  console.log("Initializing tiny vector store embeddings...");
  for (const tip of tinyVectorStoreDB) {
      if (!tip.embedding) { // Only get if not already there (e.g. if server restarts)
          const embedding = await getEmbedding(tip.text);
          if (embedding) {
              tip.embedding = embedding;
              console.log(`Embedded tip: ${tip.id}`);
          }
      }
  }
  console.log("Tiny vector store initialization complete.");
}
// Call this when the server starts, after app.listen or before if sync is ok
// For simplicity, we can call it and let it run in the background,
// or make the first RAG query wait if not ready.
// For now, let's call it and not block.
initializeVectorStore().catch(err => console.error("Failed to initialize vector store:", err));


// --- Feature Function: RAG Q&A ---
async function answerWithRAG(userQuestion, selectedUserId /* unused for now, but for future context */) {
  const userQuestionEmbedding = await getEmbedding(userQuestion);
  if (!userQuestionEmbedding) {
      return "Sorry, I couldn't process your question for RAG at the moment.";
  }

  let bestMatch = null;
  let highestSimilarity = -1;

  for (const tip of tinyVectorStoreDB) {
      if (tip.embedding) {
          const similarity = cosineSimilarity(userQuestionEmbedding, tip.embedding);
          if (similarity > highestSimilarity) {
              highestSimilarity = similarity;
              bestMatch = tip;
          }
      }
  }
  
  console.log(`RAG: Highest similarity for "${userQuestion}" is ${highestSimilarity}`);

  if (bestMatch && highestSimilarity > 0.5) { // Similarity threshold
      const ragPromptMessages = [
          { role: 'system', content: 'You are Travelite, a helpful travel assistant. Answer the user question based ONLY on the provided context. If the context is not sufficient or irrelevant, say you do not have that information in the provided context.' },
          { role: 'user', content: `Question: ${userQuestion}\n\nContext:\n${bestMatch.text}` }
      ];
      return await callWatsonxLlm(ragPromptMessages, MODEL_ID); // Use default text model
  } else {
      return "I don't have a specific travel tip for that in my current knowledge base. Would you like me to try a general answer?";
      // Or directly call LLM without context:
      // const generalPrompt = [{role:'system', content:'You are Travelite...'}, {role:'user', content: userQuestion}];
      // return await callWatsonxLlm(generalPrompt, MODEL_ID);
  }
}


// --- Feature Function: Personalized Itinerary (Simplified) ---
async function generatePersonalizedItinerary(destination, preferencesText, selectedUser) {
  const userStyle = selectedUser.preferences.travelStyle;
  let relevantActivitiesText = "No specific activities pre-selected for this style.";

  if (mockItineraryData[destination] && mockItineraryData[destination][userStyle]) {
      relevantActivitiesText = mockItineraryData[destination][userStyle].slice(0, 2).join("; ");
  } else if (mockItineraryData[destination]) {
      const allActivities = Object.values(mockItineraryData[destination]).flat();
      if (allActivities.length > 0) {
           relevantActivitiesText = allActivities.slice(0, 2).join("; ");
      }
  }
  
  const allergies = selectedUser.allergies.join(", ") || "none listed";
  const phobias = selectedUser.phobias.join(", ") || "none listed";

  const promptMessages = [
      { role: 'system', content: `You are Travelite. Create a simple, engaging 1-day itinerary. Focus ONLY on the provided context and user details. Mention user's allergies (${allergies}) and phobias (${phobias}) as considerations if relevant to activities.` },
      { role: 'user', content: `User: ${selectedUser.name}\nTravel Style: ${userStyle}\nOther Preferences: ${preferencesText || selectedUser.preferences.preferredActivities.join(", ")}\nDestination: ${destination}\n\nAvailable Activities Context: ${relevantActivitiesText}\n\nGenerate the itinerary.` }
  ];
  return await callWatsonxLlm(promptMessages, MODEL_ID);
}

// --- Feature Function: AI Caption Generation (Simplified) ---
async function generateAiCaption(imageDescription, tone, imageBufferBase64, selectedUser, visionModelId) {
  // imageBufferBase64 is already a base64 string from the client if using vision model
  const userCaptionPrefs = selectedUser.captionPreferences;
  const finalTone = tone || userCaptionPrefs.defaultTone;
  const commonHashtags = userCaptionPrefs.commonHashtags.join(" ");

  const messages = [
      { role: 'system', content: `You are a creative social media assistant. Generate a caption based ONLY on the provided image (and its description if text model) and user preferences. Tone: ${finalTone}. Include 2-3 extra relevant hashtags.` }
  ];

  let userContent;
  if (imageBufferBase64 && visionModelId) { // Use Vision Model directly
      userContent = [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBufferBase64}` } }]; // Assume jpeg for simplicity or get mime from client
      if (imageDescription) { // Can also add text to the vision model prompt
           userContent.push({ type: 'text', text: `Image description (if helpful): ${imageDescription}. User wants common hashtags: ${commonHashtags}. Generate caption.` });
      } else {
           userContent.push({ type: 'text', text: `User wants common hashtags: ${commonHashtags}. Generate caption.` });
      }
  } else { // Text model, requires image description
      if (!imageDescription) return "Please describe the image for me to generate a caption.";
      userContent = `Image described as: "${imageDescription}". User wants common hashtags: ${commonHashtags}. Generate a ${finalTone} caption.`;
  }
  
  messages.push({ role: 'user', content: userContent });
  return await callWatsonxLlm(messages, visionModelId || MODEL_ID, 150); // Shorter captions
}

// --- Feature Function: Memory Capsule Script (Simplified) ---
async function generateMemoryCapsuleScript(sceneDescriptions, mood, selectedUser) {
  if (!sceneDescriptions || sceneDescriptions.length === 0) {
      return "Please describe the scenes for the memory capsule script.";
  }
  const scenesText = sceneDescriptions.map((desc, i) => `Scene ${i+1}: ${desc}`).join("\n");

  const promptMessages = [
      { role: 'system', content: `You are Travelite, a creative storyteller. Generate a short video script/storyboard based ONLY on the provided scenes and mood. Suggest a background music style.`},
      { role: 'user', content: `User: ${selectedUser.name}\nDesired Video Mood: ${mood}\n\n${scenesText}\n\nGenerate the script and suggest music.` }
  ];
  return await callWatsonxLlm(promptMessages, MODEL_ID);
}

/* ── routes ── */
app.get('/', (req, res) => {
  // For demo, pass users to frontend to allow selection
  res.render('chat', { users: simulatedUsersDB, defaultUser: simulatedUsersDB[0] });
});

app.post('/chat', upload, async (req, res) => { // 'upload' is now using .fields
  try {
      const userText = req.body.message?.trim().toLowerCase(); // Lowercase for keyword matching
      const pickedModelId = req.body.model_id || MODEL_ID; // Model selected by user on frontend
      const selectedUserId = req.body.selected_user_id || simulatedUsersDB[0].id; // Get from frontend, default to first user
      
      const selectedUser = simulatedUsersDB.find(u => u.id === selectedUserId) || simulatedUsersDB[0];

      let reply = "";
      let imageFile = req.files?.image?.[0]; // First image if sent
      let documentFile = req.files?.document?.[0]; // If document sent
      // For multiple images (memory capsule)
      let imageFiles = req.files?.image || []; 


      // --- Intent Recognition (Very Simple Keyword-Based) ---
      if (userText && (userText.includes("itinerary for") || userText.includes("plan a trip to"))) {
          // Extract destination (very basic)
          const parts = req.body.message.split(" to "); // Use original case message
          const destination = parts.length > 1 ? parts[parts.length - 1].replace(/[?.!]/g, "") : "Paris"; // Default if not found
          const preferencesText = req.body.message; // Pass full text for now
          reply = await generatePersonalizedItinerary(destination, preferencesText, selectedUser);
      
      } else if (imageFile && (userText?.includes("caption") || userText?.includes("what is this") || !userText)) {
          // If image uploaded, and user asks for caption or says nothing, or asks "what is this"
          // For demo: user manually types description OR we use vision model
          let imageDescription = userText?.includes("caption") ? "" : req.body.message?.trim(); // If user types something other than "caption" assume it's a description or question about image
          if (userText?.includes("caption this") && req.body.message.length > "caption this".length) {
               imageDescription = req.body.message.substring("caption this".length).trim();
          }
          const tone = userText?.includes("witty") ? "witty" : (userText?.includes("elegant") ? "elegant" : selectedUser.captionPreferences.defaultTone);
          
          reply = await generateAiCaption(
              imageDescription, // Manual description for now if not using vision directly for description
              tone,
              imageFile.buffer.toString('base64'),
              selectedUser,
              pickedModelId.includes("vision") ? pickedModelId : null // Pass vision model if selected
          );

      } else if (userText && (userText.includes("memory capsule") || userText.includes("video script"))) {
          const mood = userText.includes("happy") ? "happy" : (userText.includes("adventurous") ? "adventurous" : "heartwarming");
          // For demo: assume scene descriptions are in the userText, separated by "then" or newlines, or ask for them.
          // This is highly simplified.
          const sceneDescriptions = req.body.message.split(/then\b|;|\n/i)
                                       .map(s => s.replace(/memory capsule for|video script for/i, "").trim())
                                       .filter(s => s.length > 5);
          if (imageFiles.length > 0 && sceneDescriptions.length === 0) {
              // If images were uploaded but no descriptions, ask for them
              reply = "Great! Please describe each scene or image for your memory capsule.";
          } else if (sceneDescriptions.length > 0) {
               reply = await generateMemoryCapsuleScript(sceneDescriptions, mood, selectedUser);
          } else {
               reply = "Please describe the scenes for your memory capsule (e.g., 'Scene 1: beach sunset then Scene 2: dinner with friends'). You can also upload images and describe them.";
          }

      } else if (userText && (userText.includes("tip for") || userText.includes("advice on") || userText.includes("how to") || userText.includes("what about"))) {
          reply = await answerWithRAG(req.body.message, selectedUser.id); // Pass original case message
      
      } else if (documentFile) {
          // Basic document handling: acknowledge upload
          // For a real RAG on docs, you'd extract text here.
          reply = `Document "${documentFile.originalname}" uploaded. For now, I can only use my pre-loaded travel tips for Q&A. Ask me a travel tip question!`;
      
      } else { // Default: General Chat or if image was sent with text not matching caption intent
          const messages = [{ role: 'system', content: `You are Travelite, a helpful and friendly travel assistant. Current user: ${selectedUser.name}.` }];
          const userContent = [];
          
          if (imageFile && pickedModelId.includes("vision")) { // Only add image if a vision model is picked
              userContent.push({ type: 'image_url', image_url: { url: `data:${imageFile.mimetype};base64,${imageFile.buffer.toString('base64')}` } });
          }
          if (req.body.message?.trim()) { // Original case message for general chat
               userContent.push({ type: 'text', text: req.body.message.trim() });
          }
          
          if (userContent.length > 0) {
               messages.push({ role: 'user', content: userContent.length === 1 && userContent[0].type === 'text' ? userContent[0].text : userContent });
               reply = await callWatsonxLlm(messages, pickedModelId);
          } else if (imageFile && !pickedModelId.includes("vision")) {
              reply = "Image uploaded, but a non-vision model is selected. Please ask a question about the image or select a vision model if you want me to see it.";
          }
           else {
              reply = "Please type a message or upload an image with a vision model selected.";
          }
      }

      res.json({ reply });

  } catch (err) {
      console.error('Error in /chat endpoint:', err.response?.data || err.message, err.stack);
      let errorMessage = '⚠️ Chat error. Please try again.';
      if (err.response?.data?.errors?.[0]?.message) {
          errorMessage += ` Details: ${err.response.data.errors[0].message}`;
      } else if(err.message) {
          errorMessage += ` Details: ${err.message}`;
      }
      res.status(500).json({ reply: errorMessage });
  }
});


/* ── start ── */
console.log('🔐 API_KEY present:', !!API_KEY);
console.log('🧩 PROJECT_ID:', PROJECT_ID);
console.log('🧠 Default Text MODEL:', MODEL_ID);
console.log('🧠 Embedding MODEL:', EMBEDDING_MODEL_ID);

app.listen(PORT, () => {
  console.log(`Travelite Chat UI → http://localhost:${PORT}`);
  console.log("Attempting to initialize vector store in background...");
});