const express = require('express');
const mqtt = require('mqtt');
const axios = require('axios'); // Biblioteca para fazer a chamada extra ao MP
const app = express();
const PORT = 3000;

// --- SUAS INFORMAÇÕES (Mantenha igual) ---
const MQTT_HOST = 'd848ae40758c4732b9333f823b832326.s1.eu.hivemq.cloud';
const MQTT_PORT = '8883';
const MQTT_USER = 'watervendor01';
const MQTT_PASS = 'Water2025';
const MP_ACCESS_TOKEN = 'APP_USR-2337638380276117-092714-fcb4c7f0435c786f6c58a959e3dac448-1036328569';

// --- TÓPICOS MQTT ---
const MQTT_BASE_TOPIC = 'watervendor'; // Tópico base

// --- CONEXÃO COM O BROKER MQTT ---
const client = mqtt.connect(`mqtts://${MQTT_HOST}:${MQTT_PORT}`, {
  username: MQTT_USER,
  password: MQTT_PASS,
});

client.on('connect', () => console.log('Servidor conectado ao Broker MQTT com sucesso!'));
client.on('error', (err) => console.error('Erro de conexão com o Broker MQTT:', err));

app.use(express.json());

app.get('/', (req, res) => res.send('Servidor WaterVendor está no ar!'));

// Rota que recebe as notificações do Mercado Pago
app.post('/notification', async (req, res) => {
  console.log('--- NOTIFICAÇÃO DO MP RECEBIDA ---');
  console.log('Conteúdo:', req.body);
  
  const { action, data } = req.body;

  // 1. Verificamos se é uma notificação de pagamento relevante
  if (action === 'payment.updated' && data && data.id) {
    const paymentId = data.id;
    console.log(`Notificação de pagamento recebida. ID: ${paymentId}. Consultando detalhes...`);

    try {
      // 2. "Perguntamos de volta" ao Mercado Pago pelos detalhes do pagamento
      const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      });

      const paymentDetails = response.data;
      console.log('Detalhes do pagamento recebidos com sucesso.');

      // 3. Analisamos os detalhes para confirmar a aprovação e pegar a referência
      if (paymentDetails.status === 'approved' && paymentDetails.external_reference) {
        console.log(`Pagamento APROVADO! Referência Externa: ${paymentDetails.external_reference}`);
        
        // 4. Tomamos a decisão: extraímos o ID da máquina e o volume
        const parts = paymentDetails.external_reference.split('-'); // Ex: "maquina01-1500"
        if (parts.length === 2) {
          const machineId = parts[0]; // "maquina01"
          const volume = parseInt(parts[1], 10); // 1500

          if (volume > 0) {
            const topic = `${MQTT_BASE_TOPIC}/${machineId}/comandos`;
            const message = JSON.stringify({ msg: volume });

            // 5. Publicamos o comando no MQTT
            client.publish(topic, message, (err) => {
              if (err) {
                console.error(`Falha ao publicar no tópico ${topic}:`, err);
              } else {
                console.log(`>>> Comando '${message}' publicado com sucesso no tópico '${topic}'`);
              }
            });
          }
        }
      } else {
        console.log(`Pagamento não está 'approved' ou não tem referência. Status: ${paymentDetails.status}`);
      }
    } catch (error) {
      console.error('Erro ao consultar a API do Mercado Pago:', error.message);
    }
  }

  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}.`));