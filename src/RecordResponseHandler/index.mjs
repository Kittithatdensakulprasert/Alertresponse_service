import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    const httpMethod = event.httpMethod; // เช็คว่าเป็น GET หรือ POST
    const alertId = event.pathParameters?.alertId;

    // --- ส่วนของ GET: ดึงข้อมูลไปแสดงในหน้า Admin ---
    if (httpMethod === "GET") {
        try {
            console.log(`🔍 Fetching responses for Alert: ${alertId}`);
            const queryCmd = new QueryCommand({
                TableName: "ResponseData",
                KeyConditionExpression: "alertId = :aid",
                ExpressionAttributeValues: { ":aid": alertId }
            });

            const result = await docClient.send(queryCmd);
            return {
                statusCode: 200,
                headers: { 
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*" 
                },
                body: JSON.stringify(result.Items)
            };
        } catch (error) {
            console.error("❌ Error fetching data:", error);
            return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: error.message }) };
        }
    }

    // --- ส่วนของ POST: บันทึกข้อมูลจาก Citizen (โค้ดเดิมของคุณ) ---
    if (httpMethod === "POST") {
        console.log("📥 Received Citizen Response Event:", event.body);
        try {
            const body = JSON.parse(event.body);
            const { phoneNumber, replyText } = body;

            if (!alertId || !phoneNumber || !replyText) {
                return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Missing required fields" }) };
            }

            // 1.เช็คว่า Alert มีอยู่จริงและไม่ได้ CLOSED
            const getAlertCmd = new GetCommand({
                TableName: "AlertData",
                Key: { alertId: alertId }
            });
            const alertResponse = await docClient.send(getAlertCmd);
            const alert = alertResponse.Item;

            if (!alert) return { statusCode: 404, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Alert not found" }) };
            if (alert.status === "CLOSED") return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Alert is CLOSED" }) };

            // 2.วิเคราะห์คำตอบ
            let updateField = "";
            const text = replyText.toString().trim().toUpperCase();

            if (text === "1" || text === "ACK" || text === "ACKNOWLEDGE") {
                updateField = "totalAcknowledged";
            } else if (text === "2" || text === "SAFE") {
                updateField = "totalSafe";
            } else if (text === "3" || text === "HELP" || text === "NEED_HELP") {
                updateField = "totalNeedHelp";
            } else {
                return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Invalid reply" }) };
            }

            // 3.บันทึก Response
            const timestamp = new Date().toISOString();
            const putResponseCmd = new PutCommand({
                TableName: "ResponseData", 
                Item: {
                    alertId: alertId,
                    responseId: phoneNumber,
                    phoneNumber: phoneNumber, 
                    replyText: text,
                    timestamp: new Date().toISOString()
                },
                ConditionExpression: "attribute_not_exists(responseId)" 
            });

            try {
                await docClient.send(putResponseCmd);
            } catch (error) {
                if (error.name === "ConditionalCheckFailedException") {
                    return { statusCode: 409, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Duplicate response" }) };
                }
                throw error;
            }

            // 4.อัปเดต Counter
            const updateCounterCmd = new UpdateCommand({
                TableName: "AlertData",
                Key: { alertId: alertId },
                UpdateExpression: `ADD ${updateField} :incrementValue`,
                ExpressionAttributeValues: { ":incrementValue": 1 },
                ReturnValues: "UPDATED_NEW"
            });
            
            const updatedResult = await docClient.send(updateCounterCmd);

            return {
                statusCode: 201,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify({ message: "Success", updatedCounters: updatedResult.Attributes })
            };

        } catch (error) {
            console.error("❌ Error processing POST:", error);
            return { statusCode: 500, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Internal Server Error" }) };
        }
    }
};