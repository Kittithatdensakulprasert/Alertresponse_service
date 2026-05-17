import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
    const TABLE_INCIDENTS = "Incidents";
    const TABLE_USERS = "UserLocations"; 

    try {
        // =================================================================
        // 🔴 1. โหมดรับข้อมูลแบบ Real-time (ผ่าน SNS)
        // =================================================================
        if (event.Records && event.Records[0].Sns) {
            const snsData = JSON.parse(event.Records[0].Sns.Message);

            if (snsData.users && Array.isArray(snsData.users)) {
                await Promise.all(snsData.users.map(user => {
                    return docClient.send(new PutCommand({
                        TableName: TABLE_USERS,
                        Item: {
                            phone: user.phone || `UNKNOWN-${Date.now()}`,
                            lat: parseFloat(user.lat),
                            long: parseFloat(user.long),
                            inDanger: user.in_danger || false,
                            updatedAt: user.updated_at || new Date().toISOString()
                        }
                    }));
                }));
                return { statusCode: 200, body: "User Locations Saved" };
            }

            // บันทึกเหตุการณ์ (เช็คก่อนว่ามีของเดิมที่เป็น RESOLVED ไหม)
            const incidentId = snsData.incident_id || `INC-${Date.now()}`;
            // (Optionally check existing here, but SNS usually sends new incidents)
            
            await docClient.send(new PutCommand({
                TableName: TABLE_INCIDENTS,
                Item: {
                    incidentId: incidentId,
                    incidentType: snsData.incident_type || "ไม่ระบุประเภท",
                    severity: snsData.severity || "MEDIUM",
                    location: snsData.address_name || "ไม่ระบุพิกัด",
                    lat: parseFloat(snsData.latitude || snsData.lat || 14.0635), 
                    long: parseFloat(snsData.longitude || snsData.long || 100.6092),
                    status: "ACTIVE",
                    updatedAt: new Date().toISOString()
                }
            }));
            return { statusCode: 200, body: "Incident Saved" };
        }

        const apiPath = event.path || event.rawPath || "";

        // ---> 2.1 ดึงข้อมูล "ชาวบ้าน" <---
        if (apiPath.includes("users")) {
            try {
                const res = await fetch("https://ohjs40jo9f.execute-api.us-east-1.amazonaws.com/dev/v1/users");
                const friendData = await res.json();
                const usersToSave = friendData.users || friendData || [];
                
                if (usersToSave.length > 0) {
                    await Promise.all(usersToSave.map(user => {
                        const item = {
                            phone: user.phone || `UNKNOWN-${Date.now()}-${Math.random()}`,
                            lat: parseFloat(user.lat),
                            long: parseFloat(user.long),
                            inDanger: user.in_danger || user.inDanger || false,
                            updatedAt: new Date().toISOString()
                        };
                        return docClient.send(new PutCommand({ TableName: TABLE_USERS, Item: item }));
                    }));
                }
            } catch (e) { console.error("❌ ดึงข้อมูลเพื่อนไม่สำเร็จ:", e); }

            const dbResponse = await docClient.send(new ScanCommand({ TableName: TABLE_USERS }));
            return {
                statusCode: 200,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
                body: JSON.stringify(dbResponse.Items || [])
            };
        }

        // ---> 2.2 ดึงข้อมูล "เหตุการณ์" (Sync จาก Partner) <---
        try {
            const [resRep, resImp] = await Promise.all([
                fetch("https://dcvvgbft6j.execute-api.us-east-1.amazonaws.com/v1/incidents").then(res => res.json()).catch(() => []),
                fetch("https://5ylw50ho8h.execute-api.us-east-1.amazonaws.com/impact-zones/active").then(res => res.json()).catch(() => [])
            ]);

            const reporterItems = Array.isArray(resRep) ? resRep : (resRep.items || []);
            const impactItems = Array.isArray(resImp) ? resImp : (resImp.items || []);

            const currentDbData = await docClient.send(new ScanCommand({ TableName: TABLE_INCIDENTS }));
            const existingIncidents = currentDbData.Items || [];

            const finalItemsToSave = reporterItems.map(rep => {
                const incidentId = rep.incident_id || rep.id || `INC-${Date.now()}`;
                const oldRecord = existingIncidents.find(ex => ex.incidentId === incidentId);
                
                const impact = impactItems.find(imp => 
                    (imp.sourceIncidentIds && imp.sourceIncidentIds.includes(incidentId)) ||
                    imp.id === incidentId
                );

                // 🌟 LOGIC ปรับปรุงใหม่:
                // 1. ถ้าไม่มีข้อมูลเดิมเลย -> ให้เป็น ACTIVE
                // 2. ถ้าเดิมเป็น ALERTED -> ให้คง ALERTED (Admin กำลังจัดการ)
                // 3. ถ้าเดิมเป็น RESOLVED -> ให้คง RESOLVED (ห้ามเด้งกลับมาเป็น ACTIVE)
                let finalStatus = "ACTIVE";
                if (oldRecord) {
                    if (oldRecord.status === "ALERTED") {
                        finalStatus = "ALERTED";
                    } else if (oldRecord.status === "RESOLVED") {
                        finalStatus = "RESOLVED";
                    }
                }

                return {
                    incidentId: incidentId,
                    incidentType: rep.incident_type || "ไม่ระบุประเภท",
                    severity: rep.severity || (impact ? impact.severityLevel : "MEDIUM"),
                    location: rep.address_name || "ไม่ระบุพิกัด",
                    description: rep.description || "ซิงค์จากพาร์ทเนอร์",
                    lat: rep.location?.coordinates?.[1] || impact?.centerPoint?.lat || 14.0635,
                    long: rep.location?.coordinates?.[0] || impact?.centerPoint?.lng || 100.6092,
                    impactRadius: impact?.radiusKm || (impact ? 10 : 5), 
                    affectedArea: impact?.affectedArea ? JSON.stringify(impact.affectedArea) : (oldRecord?.affectedArea || null),
                    estimatedAffectedPopulation: impact?.estimatedAffectedPopulation || 0,
                    status: finalStatus, 
                    alertMessage: oldRecord?.alertMessage || null,
                    updatedAt: new Date().toISOString()
                };
            });

            if (finalItemsToSave.length > 0) {
                await Promise.all(finalItemsToSave.map(item => docClient.send(new PutCommand({ TableName: TABLE_INCIDENTS, Item: item }))));
            }
        } catch (e) { console.error("❌ ซิงค์เหตุการณ์เพื่อนไม่สำเร็จ:", e); }

        // ดึงข้อมูลทั้งหมดอีกครั้งหลังจาก Save
        const finalDbResponse = await docClient.send(new ScanCommand({ TableName: TABLE_INCIDENTS }));
        
        // 🌟 กรองข้อมูล: ส่งเฉพาะรายการที่ยังไม่ RESOLVED ไปที่ Frontend 
        // เพื่อให้หน้า Dashboard Admin คลีนและเห็นเฉพาะงานที่ยังค้างอยู่
        const activeIncidents = (finalDbResponse.Items || []).filter(item => item.status !== "RESOLVED");

        return {
            statusCode: 200,
            headers: { 
                "Content-Type": "application/json", 
                "Access-Control-Allow-Origin": "*" 
            },
            body: JSON.stringify(activeIncidents)
        };

    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};