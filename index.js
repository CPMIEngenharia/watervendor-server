// V_FINAL_DE_VERDADE
// Baseado no V_RESET_FUNCIONAL (Axios), mas corrige a captura do paymentId.

require('dotenv').config(); 
const express = require('express');
const mqtt = require('mqtt');
const axios = require('axios'); 

const app = express();
const PORT = process.env.PORT || 10000; 

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE (O jeito do Render) 🔒
// =================================================================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
// O tópico base será lido do MQTT_TOPIC_COMANDO, mas vamos remover a parte final
const MQTT_BASE_TOPIC = process.env.MQTT_TOPIC_COMANDO ? process.env.MQTT_TOPIC_COMANDO.split('/').slice(0, -1).join('/') : 'watervendor/maquina01';


// Verificação de inicialização
if (!MP_ACCESS_TOKEN || !MQTT_BROKER_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    console.error('❌ ERRO FATAL: Verifique as Variáveis de Ambiente no RENDER!');
    console.log('MP_ACCESS_TOKEN:', MP_ACCESS_TOKEN ? 'OK' : 'FALTANDO');
    console.log('MQTT_BROKER_URL:', MQTT_BROKER_URL ? 'OK' : 'FALTANDO');
    console.log('MQTT_USERNAME:', MQTT_USERNAME ? 'OK' : 'FALTANDO');
    console.log('MQTT_PASSWORD:', MQTT_PASSWORD ? 'OK' : 'FALTANDO');
}

// --- CONEXÃO COM O BROKER MQTT (O jeito do Render) ---
console.log(`🔌 Tentando conectar ao Broker MQTT como usuário: ${MQTT_USERNAME}...`);
const client = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: `server_${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    keepalive: 30
});

client.on('connect', () => console.log('✅ Servidor conectado ao Broker MQTT com sucesso!'));
client.on('error', (err) => console.error('❌ Erro de conexão com o Broker MQTT:', err));

app.use(express.json());

app.get('/', (req, res) => res.send('Servidor WaterVendor (V_FINAL_DE_VERDADE) está no ar!'));

// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (Lógica do seu código original) 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
  console.log('--- 📥 NOTIFICAÇÃO DO MP RECEBIDA ---');
  console.log('Conteúdo:', req.body);
  
  const notificacao = req.body;
  const action = notificacao.action;
  const type = notificacao.type;

  // ESTE IF ACEITA TODOS OS EVENTOS DE PAGAMENTO
  if (action === 'payment.updated' || type === 'payment' || type === 'topic_merchant_order_wh') {
    
    // #################################################################
    // A CORREÇÃO FINAL ESTÁ AQUI
    // Pega o ID de 'data.id' (para testes) OU de 'id' (para PIX real)
    // #################################################################
    const paymentId = notificacao.data?.id || notificacao.id;

    if (!paymentId) {
        console.warn('⚠️ Notificação sem "data.id" ou "id". Ignorando.');
        return res.status(200).send('OK');
    }

    console.log(`Notificação de pagamento recebida. ID: ${paymentId}. Consultando detalhes...`);

    try {
      // Usando AXIOS (como no seu código original) e o Access Token do process.env
      const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${MP_ACCESS_TOKEN}`
        }
      });

      const paymentDetails = response.data;
      console.log('Detalhes do pagamento recebidos com sucesso.');

      if (paymentDetails.status === 'approved' && paymentDetails.external_reference) {
        console.log(`✅ Pagamento APROVADO! Referência Externa: ${paymentDetails.external_reference}`);
        
        const parts = paymentDetails.external_reference.split('-'); // Ex: "maquina01-1500"
        if (parts.length === 2) {
          const machineId = parts[0];
          const volume = parseInt(parts[1], 10);

          if (volume > 0) {
            // Usando o MQTT_BASE_TOPIC do process.env
            const topic = `${MQTT_BASE_TOPIC.split('/')[0]}/${machineId}/comandos`; 
            const message = JSON.stringify({ msg: volume });

            client.publish(topic, message, { qos: 1 }, (err) => {
              if (err) {
                console.error(`❌ Falha ao publicar no tópico ${topic}:`, err);
              } else {
                console.log(`>>> ✅ Comando '${message}' publicado com sucesso no tópico '${topic}'`);
              }
            });
          }
        } else {
            console.warn(`⚠️ Referência externa '${paymentDetails.external_reference}' não está no formato esperado 'maquina-volume'.`);
        }
      } else {
        console.log(`⏳ Pagamento não está 'approved' ou não tem referência. Status: ${paymentDetails.status}`);
      }
    } catch (error) {
      console.error('💥 Erro ao consultar a API do Mercado Pago:', error.message);
    }
  } else {
    console.log(`ℹ️ Evento do tipo "${action || type}" ignorado.`);
  }

  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}.`));