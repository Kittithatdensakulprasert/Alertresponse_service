import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const snsClient = new SNSClient({});

// ฟังก์ชันคำนวณระยะทางระหว่าง 2 จุด (Haversine Formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // รัศมีโลก (กม.)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

export const handler = async (event) => {
    for (const record of event.Records) {
        try {
            const alertData = JSON.parse(record.body);
            // ดึงพิกัดจุดเกิดเหตุ และ รัศมีแจ้งเตือน (ถ้าไม่มีให้ใช้ 5 กม. เป็นค่าเริ่มต้น)
            const { alertId, message, locationSnapshot, lat, long, radius = 5 } = alertData;

            // 1. ดึงข้อมูลผู้ใช้ทั้งหมดจากตาราง UserLocations
            const { Items: allUsers } = await docClient.send(new ScanCommand({
                TableName: "UserLocations" 
            }));

            // 2. คัดกรองเฉพาะผู้ใช้ที่อยู่ในรัศมีพื้นที่เกิดเหตุ
            const recipients = allUsers.filter(user => {
                const dist = calculateDistance(
                    parseFloat(lat), 
                    parseFloat(long), 
                    parseFloat(user.lat), 
                    parseFloat(user.long)
                );
                return dist <= radius;
            });

            const totalRecipients = recipients.length;

            console.log(`--- ตรวจพบเบอร์ในพื้นที่เกิดเหตุ (${locationSnapshot}): ${totalRecipients} เบอร์ ---`);

            // 3. แสดง Log เฉพาะเบอร์ที่อยู่ในพื้นที่จริงๆ
            if (totalRecipients > 0) {
                for (const target of recipients) {
                    console.log(`✅ [MATCH] กำลังส่ง SMS ไปที่เบอร์ในพื้นที่: ${target.phone} (ระยะห่าง: ${calculateDistance(lat, long, target.lat, target.long).toFixed(2)} กม.)`);
                }
            } else {
                console.log("❌ ไม่พบเบอร์โทรศัพท์ในรัศมีที่กำหนด");
            }

            // 4. ส่งสัญญาณอัปเดตกลับไปที่ Dashboard (SNS_TOPIC_ARN)
            const snsTopicArn = process.env.SNS_TOPIC_ARN; 
            if (snsTopicArn) {
                await snsClient.send(new PublishCommand({
                    TopicArn: snsTopicArn,
                    Message: JSON.stringify({
                        alertId: alertId,
                        totalRecipients: totalRecipients,
                        status: "ALERTED"
                    })
                }));
            }

        } catch (error) {
            console.error("❌ Error:", error);
        }
    }
    return { statusCode: 200 };
};