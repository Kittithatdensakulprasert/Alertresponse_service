import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

// 1. ำหนด Client เชื่อมต่อ AWS Services
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    console.log("📥 Received Event from SNS:", JSON.stringify(event, null, 2));

    try {
        // SNS สามารถส่งมาได้หลาย Record ใน 1 Event จึงต้องวนลูป
        for (const record of event.Records) {
            // 2. แกะข้อความ (Message) ออกมาจาก SNS payload
            const snsMessage = record.Sns.Message;
            const parsedData = JSON.parse(snsMessage);
            
            const { alertId, totalRecipients, status } = parsedData;

            if (!alertId) {
                console.warn("⚠️ ข้ามการประมวลผล: ไม่พบ alertId ในข้อความ SNS");
                continue; // ข้ามไปทำ record ถัดไป
            }

            console.log(`🔄 กำลังอัปเดต Alert ID: ${alertId} | สถานะใหม่: ${status} | จำนวนผู้รับ: ${totalRecipients}`);

            // 3.อัปเดตข้อมูลในตาราง AlertData
            const updateCmd = new UpdateCommand({
                TableName: "AlertData",
                Key: { alertId: alertId },
                UpdateExpression: "SET #st = :newStatus, totalRecipients = :total",
                ExpressionAttributeNames: {
                    "#st": "status" // Map คำว่า #st ให้หมายถึงคอลัมน์ status
                },
                ExpressionAttributeValues: {
                    ":newStatus": status || "ACTIVE",
                    ":total": totalRecipients || 0
                },
                ReturnValues: "UPDATED_NEW" // ขอให้ส่งค่าที่อัปเดตแล้วกลับมาแสดงใน Log
            });

            const result = await docClient.send(updateCmd);
            console.log(`✅ อัปเดตสถานะสำเร็จ ข้อมูลล่าสุด:`, result.Attributes);
        }

        return { statusCode: 200, body: "Subscriber updated DynamoDB successfully" };

    } catch (error) {
        console.error("❌ เกิดข้อผิดพลาดในการประมวลผล SNS Event:", error);
        throw error;
    }
};