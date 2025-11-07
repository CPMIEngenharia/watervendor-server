// V_FINAL_DE_VERDADE
// Aceita tanto 'payment' (testes) quanto 'topic_merchant_order_wh' (PIX real)

require('dotenv').config();
const express = require('express');
const mercadopago = require('mercadopago');
const mqtt = require('mqtt');

const app = express();
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
    accessToken: MP_ACCESS_TOKEN // Correção 'accessToken' (camelCase)
});
const mpPayment = new mercadopago.Payment(mpClient);

// --- Configuração do Cliente MQTT ---
console.log(`🔌 Tentando conectar ao Broker MQTT como usuário: ${MQTT_USERNAME}...`);
const mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: `server_${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5000,
    keepalive: 30
});

mqttClient.on('connect', () => console.log('✅ Conectado ao Broker MQTT com sucesso.'));
mqttClient.on('error', (err) => console.error('❌ Erro na conexão MQTT:', err.message));
mqttClient.on('close', () => console.log('🚪 Conexão MQTT fechada (evento "close").'));

// --- Middlewares ---
app.use(express.json());

// --- Rota de "Saúde" (Health Check) ---
app.get('/', (req, res) => {
    const statusMQTT = mqttClient.connected ? 'Conectado' : 'Desconectado';
    res.send(`
      <html>
        <body>
          <h1>Servidor WaterVendor Online (V_FINAL_DE_VERDADE)</h1>
          <p>Status MQTT: <strong>${statusMQTT}</strong></p>
        </body>
      </html>
    `);
});

// =================================================================
// 🚀 ROTA DE NOTIFICAÇÃO (WEBHOOK) DO MERCADO PAGO 🚀
// =================================================================
app.post('/notificacao-mp', async (req, res) => {
    console.log('--- 📥 NOTIFICAÇÃO DO MP RECEBIDA ---');
    console.log('ℹ️ Validação de Assinatura IGNORADA (Modo PIX Funcional).');

    const notificacao = req.body;
    console.log('Conteúdo (Body) recebido:', JSON.stringify(notificacao, null, 2));

    // #################################################################
    // ESTA É A CORREÇÃO FINAL: Aceita 'payment' OU 'topic_merchant_order_wh'
    // #################################################################
    if (notificacao.type === 'payment' || notificacao.type === 'topic_merchant_order_wh') {
        
        // O 'paymentId' está em 'data.id' para ambos os tipos de evento
        const paymentId = notificacao.data?.id; 
        
        if (!paymentId) {
            console.warn('⚠️ Notificação sem "data.id". Ignorando.');
            return res.sendStatus(200); 
        }
        
        console.log(`🔎 Notificação de pagamento ID: ${paymentId}. Buscando detalhes...`);

        try {
            // Esta chamada AGORA VAI FUNCIONAR, pois o access token está correto
            const paymentDetails = await mpPayment.get({ id: paymentId });
            
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
            // Se o ID for de teste (123456), vai cair aqui com "Payment not found"
            // Se o ID for real e o token estiver errado, cai aqui (mas já provamos que o token está certo)
            console.error(`💥 Erro ao buscar detalhes do pagamento ${paymentId}:`, error);
        }
    } else {
        console.log(`ℹ️ Recebido evento do tipo "${notificacao.type}". Ignorando (focando nos eventos corretos).`);
    }

    res.sendStatus(200);
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});