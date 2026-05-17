import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";


const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const sqsClient = new SQSClient({});


export const handler = async (event) => {
   try {
       // 1. รับข้อมูลจากหน้า Admin
       const body = JSON.parse(event.body);
       const { incidentId, message, status } = body; // ✅ รับ status เพิ่มจาก Frontend


       if (!incidentId || !message) {
           return {
               statusCode: 400,
               headers: { "Access-Control-Allow-Origin": "*" },
               body: JSON.stringify({ error: "กรุณาระบุ incidentId และ message" })
           };
       }


       // 2. ตรวจสอบว่าเป็นการ "จบภารกิจ" (Mark as Resolved) หรือไม่
       if (status === "RESOLVED") {
        const timestamp = new Date().toISOString();
    
        // ก. อัปเดตตาราง Incidents เพื่อเปลี่ยนสถานะเป็น RESOLVED (โค้ดเดิมของคุณ)
        await docClient.send(new UpdateCommand({
            TableName: "Incidents",
            Key: { incidentId: incidentId },
            UpdateExpression: "SET #s = :status, updatedAt = :time",
            ExpressionAttributeNames: { "#s": "status" },
            ExpressionAttributeValues: {
                ":status": "RESOLVED",
                ":time": timestamp
            }
        }));
    
        // ข. ✅ เพิ่มส่วนนี้: สร้าง Record ใหม่ใน AlertData เพื่อส่งสัญญาณ "คลี่คลาย" ให้ประชาชน
        const resolvedAlertId = `ALT-RES-${randomUUID().split('-')[0].toUpperCase()}`;
        
        const resolvedItem = {
            alertId: resolvedAlertId,
            incidentId: incidentId,
            message: "✅ [ประกาศสถานการณ์คลี่คลาย] ขณะนี้เหตุการณ์เข้าสู่ภาวะปกติแล้ว โปรดตรวจสอบความปลอดภัยรอบตัวท่าน",
            status: "RESOLVED", // กำหนดสถานะเป็น RESOLVED เพื่อให้หน้าจอเด้งเตือนรอบที่สอง
            createdAt: timestamp,
            // ข้อมูล snapshot อื่นๆ (ถ้าต้องการแสดงผลในหน้าแจ้งเตือนคลี่คลาย)
            severitySnapshot: "RESOLVED",
            locationSnapshot: "พื้นที่เดิม" 
        };
    
        await docClient.send(new PutCommand({
            TableName: "AlertData",
            Item: resolvedItem
        }));
    
        return {
            statusCode: 200,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ 
                message: "จบภารกิจและส่งประกาศคลี่คลายสำเร็จ", 
                incidentId,
                alertId: resolvedAlertId 
            })
        };
    }


       // --- ส่วนเดิมสำหรับการสร้างการแจ้งเตือน (ALERTED) ---


       // 3. ดึงข้อมูลจากตาราง Incidents (Data Snapshot)
       let incidentSnapshot = null;
       try {
           const getRes = await docClient.send(new GetCommand({
               TableName: "Incidents",
               Key: { incidentId: incidentId }
           }));
           incidentSnapshot = getRes.Item;
       } catch (err) {
           console.error("❌ ดึงข้อมูล Incident ไม่สำเร็จ:", err);
       }


       if (!incidentSnapshot) {
           return {
               statusCode: 404,
               headers: { "Access-Control-Allow-Origin": "*" },
               body: JSON.stringify({ error: "ไม่พบข้อมูลเหตุการณ์ต้นทางในฐานข้อมูล" })
           };
       }


       // 4. เตรียมข้อมูลสำหรับตาราง AlertData
       const alertId = `ALT-${randomUUID().split('-')[0].toUpperCase()}`;
       const timestamp = new Date().toISOString();


       const alertItem = {
           alertId: alertId,
           incidentId: incidentId,
           message: message,
           status: "ACTIVE",
           lat: incidentSnapshot.lat,
           long: incidentSnapshot.long,
           radius: incidentSnapshot.impactRadius || incidentSnapshot.radius || 5,
           severitySnapshot: incidentSnapshot.severity || "MEDIUM",
           locationSnapshot: incidentSnapshot.location || "ไม่ระบุพิกัด",
           incidentTypeSnapshot: incidentSnapshot.incidentType || "ทั่วไป",
           createdAt: timestamp,
           totalAcknowledged: 0,
           totalSafe: 0,
           totalNeedHelp: 0
       };


       // 5. บันทึกลง DynamoDB (ตาราง AlertData)
       await docClient.send(new PutCommand({
           TableName: "AlertData",
           Item: alertItem
       }));


       // 6. อัปเดตสถานะในตาราง Incidents เพื่อ Lock ปุ่มหน้า Admin เป็น ALERTED
       await docClient.send(new UpdateCommand({
           TableName: "Incidents",
           Key: { incidentId: incidentId },
           UpdateExpression: "SET #s = :status, alertMessage = :msg, alertedAt = :time, updatedAt = :time",
           ExpressionAttributeNames: { "#s": "status" },
           ExpressionAttributeValues: {
               ":status": "ALERTED",
               ":msg": message,
               ":time": timestamp
           }
       }));


       // 7. ส่งเข้า SQS (เฉพาะกรณีแจ้งเตือนภัย)
       const queueUrl = process.env.SQS_QUEUE_URL;
       if (queueUrl) {
           try {
               await sqsClient.send(new SendMessageCommand({
                   QueueUrl: queueUrl,
                   MessageBody: JSON.stringify(alertItem)
               }));
           } catch (sqsErr) {
               console.error("⚠️ SQS Send Error:", sqsErr);
           }
       }


       return {
           statusCode: 201,
           headers: {
               "Content-Type": "application/json",
               "Access-Control-Allow-Origin": "*"
           },
           body: JSON.stringify({
               message: "สร้างการแจ้งเตือนสำเร็จ",
               alertId: alertId,
               incidentStatus: "ALERTED"
           })
       };


   } catch (error) {
       console.error("❌ Error:", error);
       return {
           statusCode: 500,
           headers: {
               "Content-Type": "application/json",
               "Access-Control-Allow-Origin": "*"
           },
           body: JSON.stringify({ error: error.message })
       };
   }
};
