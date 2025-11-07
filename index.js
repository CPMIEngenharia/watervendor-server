// V_RESET_PIX_FUNCIONAL
// Voltando ao código que funcionava (sem validação de assinatura)
// e usando a porta correta do Render.

require('dotenv').config(); // <-- Mantendo o dotenv para carregar as chaves
const express = require('express');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
// O Render define a porta pela variável de ambiente PORT, ou 10000
const PORT = process.env.PORT || 10000;

// =================================================================
// 🔒 CARREGANDO VARIÁVEIS DE AMBIENTE 🔒
// =================================================================
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_COMANDO = process.env.MQTT_TOPIC_COMANDO;

// Verificação de inicialização
if (!MP_ACCESS_TOKEN || !MQTT_BROKER_URL || !MQTT_USERNAME || !MQTT_PASSWORD) {
    console.error('❌ ERRO FATAL: Verifique as Variáveis de Ambiente no RENDER!');
    console.log('MP_ACCESS_TOKEN:', MP_ACCESS_TOKEN ? 'OK' : 'FALTANDO');
    console.log('MQTT_BROKER_URL:', MQTT_BROKER_URL ? 'OK' : 'FALTANDO');
    console.log('MQTT_USERNAME:', MQTT_USERNAME ? 'OK' : 'FALTANDO');
    console.log('MQTT_PASSWORD:', MQTT_PASSWORD ? 'OK' : 'FALTANDO');
}

// --- Configuração do Mercado Pago (SDK v3) ---
console.log('🔌 Configurando cliente Mercado Pago (SDK v3)...');
const mpClient = new mercadopago.MercadoPagoConfig({
    access_token: MP_ACCESS_TOKEN
});
const mpPayment = new mercadopago.Payment(mpClient);

// --- Configuração do Cliente MQTT ---
console.log(`🔌 Tentando conectar ao Broker MQTT como usuário: ${MQTT_USERNAME}...`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: `server_${Math.random().toString(16).slice(2, 8)}`, // ID de cliente único
    reconnectPeriod: 5000,
    keepalive: 30
});

mqttClient.on('connect', () => console.log('✅ Conectado ao Broker MQTT com sucesso.'));
mqttClient.on('error', (err) => console.error('❌ Erro na conexão MQTT:', err.message));
mqttClient.on('close', () => console.log('🚪 Conexão MQTT fechada (evento "close").'));

// --- Middlewares ---
// Este código NÃO precisa do rawBody, então usamos o express.json() simples
app.use(express.json());

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    const statusMQTT = mqttClient.connected ? 'Conectado' : 'Desconectado';
    res.send(`
      <html>
        <body>
          <h1>Servidor WaterVendor Online (V_RESET_PIX_FUNCIONAL)</h1>
          <p>Status MQTT: <strong>${statusMQTT}</strong></p>
        </body>
      </html>
    `);
});

// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// (Versão SIMPLES, SEM Assinatura Secreta)
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    console.log('--- 📥 NOTIFICAÇÃO DO MP RECEBIDA ---');
    
    // --- SEM VALIDAÇÃO DE ASSINATURA ---
    console.log('ℹ️ Validação de Assinatura IGNORADA (Modo PIX Funcional).');

    // --- Processamento do Pagamento ---
    const notificacao = req.body;
    console.log('Conteúdo (Body) recebido:', JSON.stringify(notificacao, null, 2));

    // Verificamos se é uma notificação de "payment"
    if (notificacao.type === 'payment') {
        const paymentId = notificacao.data?.id; 
        
        if (!paymentId) {
            console.warn('⚠️ Notificação de "payment" sem "data.id". Ignorando.');
            // Respondemos 200 para o MP parar de tentar
            return res.sendStatus(200); 
        }
        
        console.log(`🔎 Notificação de pagamento ID: ${paymentId}. Buscando detalhes...`);

        try {
            // Buscamos os detalhes do pagamento na API do MP
            const paymentDetails = await mpPayment.get({ id: paymentId });
            
            // Verificamos o status
            if (paymentDetails.status === 'approved') {
                console.log('✅ PAGAMENTO APROVADO! Preparando para enviar comando MQTT...');
                const mensagemMQTT = 'LIBERAR_AGUA';
                
                if (mqttClient.connected) {
                    mqttClient.publish(MQTT_TOPIC_COMANDO, mensagemMQTT, { qos: 1 }, (err) => {
                        if (err) {
                            console.error('❌ Erro ao publicar mensagem no MQTT:', err);
                        } else {
                            console.log(`🚀 Comando "${mensagemMQTT}" publicado com sucesso no tópico "${MQTT_TOPIC_COMANDO}".`);
                        }
                    });
                } else {
                     console.error('❌ ERRO CRÍTICO: MQTT não conectado. Comando NÃO enviado.');
                }
            } else {
                console.log(`⏳ Pagamento ${paymentId} ainda está "${paymentDetails.status}". Aguardando.`);
            }
        } catch (error) {
            console.error(`💥 Erro ao buscar detalhes do pagamento ${paymentId}:`, error.message);
        }
    } else {
        console.log(`ℹ️ Recebido evento do tipo "${notificacao.type}". Ignorando (focando em "payment").`);
    }

    // Respondemos 200 (OK) para o MP, não importa o que aconteça,
    // para ele parar de enviar este webhook.
    res.sendStatus(200);
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});