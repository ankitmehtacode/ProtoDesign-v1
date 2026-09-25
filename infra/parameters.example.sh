#!/usr/bin/env bash
# Copy this file to parameters.sh (gitignored) and fill in real values.
# Never commit parameters.sh -- it holds live secrets.
#
# Usage:
#   source infra/parameters.sh
#   cd infra && sam build && sam deploy --parameter-overrides "$PARAMETER_OVERRIDES"
#
# Each line is passed to SAM as Key=Value; SAM splits on the first '=' only,
# so a value that itself contains '=' (e.g. a DB URL's ?sslmode=require) is
# safe. Values must not contain spaces -- strip spaces from a Gmail App
# Password if it was shown to you as four groups of four characters.

PARAMETER_OVERRIDES=$(cat <<'PARAMS' | tr '\n' ' '
StlBucketName=protodesign-models-CHANGE-ME
DatabaseUrl=postgresql://user:pass@YOUR-NEON-HOST-pooler.neon.tech/dbname?sslmode=require
JwtSecret=CHANGE-ME-run-openssl-rand-base64-48
JwtExpiry=7d
GoogleClientId=
EmailUser=
EmailPass=
CloudinaryCloudName=
CloudinaryApiKey=
CloudinaryApiSecret=
PhonePeClientId=
PhonePeClientSecret=
PhonePeClientVersion=1
PhonePeEnv=production
PhonePeWebhookUsername=
PhonePeWebhookPassword=
FrontendUrls=https://your-app.vercel.app
FrontendOriginPattern=
BackendUrl=
FrontendUrl=https://your-app.vercel.app
WhatsAppMode=off
WhatsAppAccessToken=
WhatsAppPhoneNumberId=
WhatsAppBusinessNumber=
WhatsAppVerifyToken=
MetaAppSecret=
WhatsAppApiVersion=v23.0
WhatsAppPaidTemplates=false
WhatsAppTemplateOrderUpdate=
WhatsAppTemplateQuoteUpdate=
WhatsAppTemplateLanguage=en
WhatsAppTestRecipients=
PARAMS
)
export PARAMETER_OVERRIDES
