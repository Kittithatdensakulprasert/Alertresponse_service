# Alert Response Service

Disaster Management System - Alert Broadcasting & Citizen Response Service

## 🎯 Overview

Alert Response Service เป็นบริการจัดการการแจ้งเตือนภัยพิบัติและรับการตอบสนองจากประชาชน ทำหน้าที่เชื่อมต่อระหว่างผู้บริหารและประชาชนผ่านระบบแจ้งเตือนอัตโนมัติและการติดตามสถานะความปลอดภัย

### Key Features

- ✅ สร้างและส่งการแจ้งเตือนภัยพิบัติไปยังประชาชนในพื้นที่เสี่ยง
- ✅ รับการตอบสนองจากประชาชนผ่าน SMS (ACKNOWLEDGE, SAFE, NEED HELP)
- ✅ ซิงค์ข้อมูลเหตุการณ์จากบริการพาร์ทเนอร์ (Incident Reporter, Impact Zones)
- ✅ ติดตามสถานะการแจ้งเตือน (ACTIVE, RESOLVED)
- ✅ จัดการ State Machine ของสถานะเหตุการณ์ (ACTIVE → ALERTED → RESOLVED)
- ✅ Event-Driven Architecture (SNS/SQS)
- ✅ เช็คซ้ำการตอบสนองของผู้ใช้งาน
- ✅ รองรับการแจ้งเตือนภาวะคลี่คลาย (All-Clear Notification)

---

## 🏗️ Architecture

```
Admin Dashboard → API Gateway → Lambda Functions → DynamoDB
                                    ↓
                                  SNS Topics → Subscribers
                                    ↑
                               SQS Queues ← SMS Service
                                    ↑
Partner Services (Incident Reporter, Impact Zones)
```

### Technologies

- **Compute**: AWS Lambda (Node.js)
- **API**: Amazon API Gateway (REST)
- **Database**: Amazon DynamoDB
- **Messaging**: Amazon SNS + SQS
- **Language**: JavaScript (ES Modules)

---

## 🚀 Quick Start

### Prerequisites

- AWS Account
- AWS CLI configured
- Node.js >= 18.x
- DynamoDB tables created (AlertData, ResponseData, Incidents, UserLocations)

### Installation

1. **Clone repository**
```bash
git clone <your-repo>
cd Alertresponse_service
```

2. **Install dependencies**
```bash
cd src
npm install
```

3. **Deploy Lambda functions**
```bash
# Deploy each Lambda function using AWS Console or AWS CLI
# Or use deployment script if available
```

4. **Configure environment variables**
```bash
# Set required environment variables for each Lambda:
# - SQS_QUEUE_URL
# - AWS_REGION
```

---

## 📡 API Endpoints

**Base URL**: `https://<api-id>.execute-api.us-east-1.amazonaws.com/v1`

### Synchronous APIs

| Method | Endpoint | Description | Lambda Function |
|--------|----------|-------------|-----------------|
| POST | `/alert` | Create alert for incident | CreateAlertHandler |
| GET | `/alert/latest` | Get latest alert for citizen | GetLatestAlert |
| POST | `/response/{alertId}` | Record citizen response | RecordResponseHandler |
| GET | `/response/{alertId}` | Get all responses for alert | RecordResponseHandler |
| GET | `/sync/incidents` | Sync incidents from partners | SyncIncidentHandler |
| GET | `/sync/users` | Sync user locations | SyncIncidentHandler |

### Events (Asynchronous)

**Published by this service:**
- None (this service primarily consumes events)

**Consumed by this service:**
- User location updates ← SNS Topic (SyncIncidentHandler)
- Incident updates ← SNS Topic (SyncIncidentHandler)
- SMS dispatch status ← SNS Topic (AlertResponseSubscriber)

---

## 🧪 Testing

### Manual Testing

```bash
# Get API URL from AWS Console

# Create alert
curl -X POST "<API_URL>/alert" \
  -H "Content-Type: application/json" \
  -d '{
    "incidentId": "INC-12345",
    "message": "⚠️ เตือนภัยน้ำท่วมในพื้นที่ โปรดอพยพย้ายไปยังพื้นที่ปลอดภัย",
    "status": "ACTIVE"
  }'

# Get latest alert for citizen
curl "<API_URL>/alert/latest?phone=0812345678"

# Record citizen response
curl -X POST "<API_URL>/response/ALT-ABC123" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "0812345678",
    "replyText": "2"
  }'

# Get all responses for alert
curl "<API_URL>/response/ALT-ABC123"

# Sync incidents from partners
curl "<API_URL>/sync/incidents"

# Sync user locations
curl "<API_URL>/sync/users"
```

### Response Options

Citizens can respond with:
- **"1"** or **"ACK"** or **"ACKNOWLEDGE"** - รับทราบการแจ้งเตือน
- **"2"** or **"SAFE"** - ปลอดภัย
- **"3"** or **"HELP"** or **"NEED_HELP"** - ต้องการความช่วยเหลือ

---

## 📊 Database Schema

### DynamoDB Tables

#### AlertData
- **Partition Key**: alertId (String)
- **Attributes**:
  - incidentId: Reference to incident
  - message: Alert message content
  - status: ACTIVE, RESOLVED
  - lat, long: Alert location coordinates
  - radius: Impact radius in km
  - severitySnapshot: Incident severity level
  - locationSnapshot: Location description
  - incidentTypeSnapshot: Type of incident
  - createdAt: Timestamp
  - totalAcknowledged: Counter for acknowledgments
  - totalSafe: Counter for safe responses
  - totalNeedHelp: Counter for help requests
  - totalRecipients: Total recipients notified

#### ResponseData
- **Partition Key**: alertId (String)
- **Sort Key**: responseId (String - phoneNumber)
- **Attributes**:
  - phoneNumber: Citizen's phone number
  - replyText: Response text (1/2/3 or ACK/SAFE/HELP)
  - timestamp: Response timestamp

#### Incidents
- **Partition Key**: incidentId (String)
- **Attributes**:
  - incidentType: Type of incident
  - severity: Severity level
  - location: Location description
  - lat, long: Coordinates
  - impactRadius: Impact radius
  - status: ACTIVE, ALERTED, RESOLVED
  - alertMessage: Alert message sent
  - alertedAt: Timestamp when alert was sent
  - updatedAt: Last update timestamp

#### UserLocations
- **Partition Key**: phone (String)
- **Attributes**:
  - lat, long: User coordinates
  - inDanger: Boolean flag
  - updatedAt: Last update timestamp

---

## 🔗 Integration with Other Services

### Upstream Services (ผู้เรียกใช้)

1. **Admin Dashboard** - สร้างและจัดการการแจ้งเตือน
2. **Citizen Mobile App** - รับแจ้งเตือนและตอบสนอง
3. **SMS Service** - ส่งและรับ SMS จากประชาชน

### Partner Services (ซิงค์ข้อมูล)

1. **Incident Reporter Service** 
2. **Impact Zones Service** 
3. **User Location Service** 

### Downstream Services (ผู้รับ Events)

1. **SMS Dispatch Worker** - รับข้อมูลการแจ้งเตือนจาก SQS เพื่อส่ง SMS

---

## 🛠️ Development

### Project Structure

```
Alertresponse_service/
├── src/                          # Lambda function code
│   ├── AlertResponseSubscriber/  # SNS subscriber for SMS status updates
│   ├── CreateAlertHandler/       # Create alert from admin
│   ├── GetLatestAlert/           # Get latest alert for citizen
│   ├── RecordResponseHandler/    # Record citizen response (GET/POST)
│   └── SyncIncidentHandler/      # Sync data from partner services              
├── AlertResponse Service_Documentation.pdf
└── README.md
```

### Lambda Functions

#### CreateAlertHandler
- รับข้อมูลจาก Admin Dashboard
- สร้าง Alert record ใน AlertData
- อัปเดตสถานะ Incident เป็น ALERTED
- ส่งข้อมูลเข้า SQS สำหรับ SMS dispatch
- รองรับการสร้างประกาศคลี่คลาย (RESOLVED status)

#### GetLatestAlert
- ดึง Alert ล่าสุดสำหรับประชาชน
- เช็คว่าผู้ใช้เคยตอบแล้วหรือยัง (ป้องกัน spam)
- ถ้า Alert เป็น RESOLVED จะส่งเสมอ (เพื่อแจ้งเตือนคลี่คลาย)

#### RecordResponseHandler
- **POST**: บันทึกการตอบสนองจากประชาชน
- **GET**: ดึงรายการการตอบสนองทั้งหมดสำหรับ Admin
- อัปเดต counters (totalAcknowledged, totalSafe, totalNeedHelp)
- ป้องกันการตอบซ้ำ (ConditionalCheckFailedException)

#### SyncIncidentHandler
- ซิงค์ข้อมูลเหตุการณ์จาก Incident Reporter Service
- ซิงค์ข้อมูล Impact Zones
- ซิงค์ข้อมูลตำแหน่งผู้ใช้งาน
- รองรับ Real-time sync ผ่าน SNS
- รักษาสถานะ ALERTED และ RESOLVED (ไม่ให้ reset)

#### AlertResponseSubscriber
- รับ SNS events จาก SMS Dispatch Worker
- อัปเดต totalRecipients และ status ใน AlertData

---

## 🔄 Workflow

### Alert Creation Flow

```
1. Admin กดปุ่ม "ส่งแจ้งเตือน" ใน Dashboard
   ↓
2. CreateAlertHandler รับ request
   ↓
3. ดึงข้อมูล Incident จาก DynamoDB
   ↓
4. สร้าง Alert record ใน AlertData
   ↓
5. อัปเดต Incident status → ALERTED
   ↓
6. ส่งข้อมูลเข้า SQS
   ↓
7. SMS Dispatch Worker อ่านจาก SQS และส่ง SMS
   ↓
8. AlertResponseSubscriber รับ status จาก SNS และอัปเดต totalRecipients
```

### Citizen Response Flow

```
1. ประชาชนได้รับ SMS แจ้งเตือน
   ↓
2. ตอบกลับด้วย SMS (1/2/3)
   ↓
3. SMS Service ส่งข้อมูลไป RecordResponseHandler
   ↓
4. ตรวจสอบว่า Alert ยังเปิดอยู่ (ไม่ RESOLVED)
   ↓
5. วิเคราะห์คำตอบ (ACK/SAFE/HELP)
   ↓
6. บันทึก Response ใน ResponseData (ป้องกันซ้ำ)
   ↓
7. อัปเดต counter ใน AlertData
```

### Resolution Flow

```
1. Admin กดปุ่ม "จบภารกิจ" ใน Dashboard
   ↓
2. CreateAlertHandler รับ request พร้อม status="RESOLVED"
   ↓
3. อัปเดต Incident status → RESOLVED
   ↓
4. สร้าง Alert record ใหม่ (type RESOLVED) สำหรับแจ้งคลี่คลาย
   ↓
5. ส่งเข้า SQS เพื่อแจ้งประชาชน
   ↓
6. ประชาชนได้รับแจ้งเตือนคลี่คลาย
```

---

## 🔒 Security

- API Gateway: CORS enabled for specific origins
- Lambda: IAM role with least privilege
- DynamoDB: Conditional writes for duplicate prevention
- SNS/SQS: Message encryption available

---

## 📈 Monitoring

- **CloudWatch Logs**: All Lambda functions log to CloudWatch
- **CloudWatch Metrics**: API Gateway and Lambda metrics
- **DynamoDB**: Consumed read/write capacity units

---
