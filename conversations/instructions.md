# Running conversations

## Install requirements
```bash
npm install express body-parser axios dotenv twilio
sudo snap install ngrok
```

## Start the server
```bash
node index.js
```

## Start ngrok
```bash
bash start-ngrok.sh
```

## Expose the ngrok URL
You can use the ngrok URL to expose your local server to the internet. (ngrok will give you a public "Forwarding" URL (e.g., https://abcdef123456.ngrok.io).)
This is useful for testing webhooks or APIs that require a public URL.
In Twilio, you can set the webhook URL to the ngrok URL followed by `/incoming` (e.g., https://abcdef123456.ngrok.io/incoming).

```bash
Go to your Twilio WhatsApp Sandbox settings (or your phone number's messaging configuration).
Set the "WHEN A MESSAGE COMES IN" webhook URL to your ngrok URL + /incoming (e.g., https://abcdef123456.ngrok.io/incoming).
Ensure the method is HTTP POST.
```