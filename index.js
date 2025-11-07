// V_FINAL_CORRIGIDO
// Corrigido o bug 'access_token' vs 'accessToken' na SDK v3 do MP

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

// #################################################################
// ESTA É A CORREÇÃO: 'accessToken' (camelCase)
// #################################################################
const mpClient = new mercadopago.MercadoPagoConfig({
    accessToken: MP_ACCESS_TOKEN 
});
// #################################################################

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
          <h1>Servidor WaterVendor Online (V_FINAL_CORRIGIDO)</h1>
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

    if (notificacao.type === 'payment') {
        const paymentId = notificacao.data?.id; 
        
        if (!paymentId) {
            console.warn('⚠️ Notificação de "payment" sem "data.id". Ignorando.');
            return res.sendStatus(200); 
        }
        
        console.log(`🔎 Notificação de pagamento ID: ${paymentId}. Buscando detalhes...`);

        try {
            // Esta chamada agora deve funcionar
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
            // Aqui vamos imprimir o erro completo para ver o que é
            console.error(`💥 Erro ao buscar detalhes do pagamento ${paymentId}:`, error);
        }
    } else {
        console.log(`ℹ️ Recebido evento do tipo "${notificacao.type}". Ignorando (focando em "payment").`);
    }

    res.sendStatus(200);
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});