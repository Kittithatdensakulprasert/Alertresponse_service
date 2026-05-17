import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    // 1. ดึงเบอร์จาก queryString และล้างข้อมูลให้สะอาด
    const phoneNumber = event.queryStringParameters?.phone?.trim() || "anonymous";

    try {
        // 2. ดึง Alert ทั้งหมดมาตรวจสอบ (แนะนำให้ใช้ Query แทน Scan ในอนาคตถ้าข้อมูลเยอะขึ้น)
        const scanCmd = new ScanCommand({ TableName: "AlertData" });
        const res = await docClient.send(scanCmd);
        const allItems = res.Items || [];
        
        if (allItems.length === 0) {
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
                body: JSON.stringify(null)
            };
        }

        // 3. เรียงลำดับเอาตัวล่าสุด (createdAt)
        const latestAlert = allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

        // 4. กรณีสถานะเป็น RESOLVED -> ต้องส่งกลับเสมอเพื่อให้หน้าจอเด้งเขียว (ไม่ต้องเช็ค Response)
        if (latestAlert.status === "RESOLVED") {
            return {
                statusCode: 200,
                headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
                body: JSON.stringify(latestAlert)
            };
        }

        // 5. กรณีสถานะปกติ (ACTIVE/ALERTED) -> เช็คว่าเบอร์นี้เคยตอบหรือยัง
        try {
            const checkRes = await docClient.send(new GetCommand({
                TableName: "ResponseData",
                Key: { 
                    alertId: latestAlert.alertId,    // Partition Key
                    responseId: phoneNumber          // Sort Key (ต้องส่ง phoneNumber เข้าไปที่ช่องนี้)
                }
            }));

            // ถ้ามีข้อมูลแปลว่าตอบแล้ว ให้ส่ง null เพื่อสั่งให้ Frontend เงียบ
            if (checkRes.Item) {
                console.log(`✅ User ${phoneNumber} answered alert ${latestAlert.alertId}. Muting notification.`);
                return {
                    statusCode: 200,
                    headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
                    body: JSON.stringify(null) // ส่ง null = ไม่ต้องแจ้งเตือน
                };
            }
        } catch (dbErr) {
            console.error("⚠️ DynamoDB Get Error:", dbErr);
            // ถ้าเช็คพัง ให้ปล่อยไหลไปแจ้งเตือนก่อนเพื่อความปลอดภัย
        }

        // 6. ยังไม่เคยตอบ -> ส่ง Alert ไปร้องเตือนประชาชน
        return {
            statusCode: 200,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
            body: JSON.stringify(latestAlert)
        };

    } catch (error) {
        console.error("❌ Lambda System Error:", error);
        return {
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
            body: JSON.stringify({ error: error.message })
        };
    }
};