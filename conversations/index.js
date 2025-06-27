// index.js
require('dotenv').config(); // To load environment variables from a .env file
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const { MessagingResponse } = require('twilio').twiml;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Environment Variables
const IBM_API_KEY = process.env.IBM_API_KEY; // Your IBM Cloud API Key
const WATSONX_PROJECT_ID = process.env.WATSONX_PROJECT_ID; // Your Watsonx.ai Project ID
const WATSONX_MODEL_ID = process.env.WATSONX_MODEL_ID || 'google/flan-ul2'; // Specify your model or use a default
const WATSONX_API_ENDPOINT = process.env.WATSONX_API_ENDPOINT || 'https://us-south.ml.cloud.ibm.com'; // Or your specific region

let ibmIamToken = {
    value: null,
    expiresAt: 0,
};

// Function to get IBM IAM Token
async function getIbmIamToken() {
    if (ibmIamToken.value && Date.now() < ibmIamToken.expiresAt) {
        console.log('Using cached IBM IAM token.');
        return ibmIamToken.value;
    }

    console.log('Fetching new IBM IAM token...');
    const url = "https://iam.cloud.ibm.com/identity/token";
    const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
    };
    const data = `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${IBM_API_KEY}`;

    try {
        const response = await axios.post(url, data, { headers });
        const tokenData = response.data;
        ibmIamToken.value = tokenData.access_token;
        // Cache token for 50 minutes (token is valid for 60 minutes)
        ibmIamToken.expiresAt = Date.now() + (tokenData.expires_in - 600) * 1000;
        console.log('Successfully fetched IBM IAM token.');
        return ibmIamToken.value;
    } catch (error) {
        console.error('Error fetching IBM IAM token:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch IBM IAM token');
    }
}

// Function to call watsonx.ai (using chat endpoint)
async function getWatsonxResponse(userMessage) {
    if (!process.env.IBM_API_KEY || !process.env.WATSONX_PROJECT_ID || !process.env.WATSONX_MODEL_ID || !process.env.WATSONX_API_ENDPOINT) {
        console.error('One or more Watsonx.ai environment variables are not set (IBM_API_KEY, WATSONX_PROJECT_ID, WATSONX_MODEL_ID, WATSONX_API_ENDPOINT).');
        return 'Configuration error: Watsonx.ai environment variables missing.';
    }

    try {
        const accessToken = await getIbmIamToken(); // Assuming getIbmIamToken is defined elsewhere and works

        const apiUrl = process.env.WATSONX_API_ENDPOINT; // Using the full endpoint URL from .env

        const headers = {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        };

        const body = {
            "model_id": process.env.WATSONX_MODEL_ID,
            "project_id": process.env.WATSONX_PROJECT_ID,
            "messages": [
                {
                    "role": "user",
                    "content": userMessage
                }
            ],
            "parameters": { // These are the parameters you used in your successful cURL
                "decoding_method": "greedy",
                "max_new_tokens": 250,
                "min_new_tokens": 10, // Set to 1 if you want potentially shorter responses
                "repetition_penalty": 1.05
                // Add other parameters like temperature if using "sample" decoding_method
            }
        };

        console.log('Sending to Watsonx.ai with URL:', apiUrl);
        console.log('Sending to Watsonx.ai with body:', JSON.stringify(body, null, 2));

        const response = await axios.post(apiUrl, body, { headers });

        // Log the full response data for detailed inspection if needed
        // console.log('Watsonx.ai raw response data:', JSON.stringify(response.data, null, 2));

        if (response.data && response.data.choices && response.data.choices.length > 0 &&
            response.data.choices[0].message && response.data.choices[0].message.content) {
            
            // Check for warnings from the API, if any
            if (response.data.system && response.data.system.warnings && response.data.system.warnings.length > 0) {
                console.warn("Warnings from Watsonx.ai API:", response.data.system.warnings);
            }
            
            return response.data.choices[0].message.content;
        } else {
            console.error('Unexpected Watsonx.ai response structure. Full response:', JSON.stringify(response.data, null, 2));
            return "Sorry, I couldn't parse the AI's response correctly.";
        }

    } catch (error) {
        console.error('Error calling Watsonx.ai:');
        if (error.response) {
            // Axios error with a response from the server
            console.error('Status:', error.response.status);
            console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
            if (error.response.status === 401) {
                // Invalidate token on auth error so it refetches next time
                ibmIamToken.value = null; // Assuming ibmIamToken is accessible in this scope
                ibmIamToken.expiresAt = 0;
                return "Authentication with AI service failed. Please try again shortly (token might have expired).";
            } else if (error.response.data && error.response.data.errors) {
                // Watsonx specific error messages
                return `AI service error: ${error.response.data.errors.map(e => e.message).join(', ')}`;
            }
        } else if (error.request) {
            // Axios error where the request was made but no response was received
            console.error('Request data:', error.request);
            return 'Sorry, no response received from the AI service.';
        } else {
            // Other errors (e.g., setup issues)
            console.error('Error message:', error.message);
        }
        return `Sorry, I encountered an error trying to reach the AI: ${error.message}`;
    }
}

// Webhook: receives incoming WhatsApp messages from Twilio
app.post('/incoming', async (req, res) => {
    const incomingMsg = req.body.Body;
    const from = req.body.From; // Sender's WhatsApp number
    const to = req.body.To; // Your Twilio WhatsApp number

    console.log(`Received message from ${from}: "${incomingMsg}" to ${to}`);

    // Step 1: Call watsonx.ai
    const watsonxReply = await getWatsonxResponse(incomingMsg);
    console.log(`Watsonx.ai replied: "${watsonxReply}"`);

    // Step 2: Respond back to WhatsApp
    const twiml = new MessagingResponse();
    twiml.message(watsonxReply);

    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
});

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Make sure IBM_API_KEY, WATSONX_PROJECT_ID, and WATSONX_MODEL_ID are set in your environment or .env file.');
    console.log(`Configured Watsonx Model ID: ${WATSONX_MODEL_ID}`);
    console.log(`Configured Watsonx API Endpoint: ${WATSONX_API_ENDPOINT}`);
});