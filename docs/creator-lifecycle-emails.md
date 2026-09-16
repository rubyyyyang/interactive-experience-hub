# Creator Lifecycle Email Reference

This document specifies the approved creator lifecycle email notifications sent by the Interactive Experience Hub.

**Note**: This is the human-readable product/operations reference for lifecycle email content and behavior. Executable email dispatch logic and workflow conditions remain in `RM_Creator_Lifecycle_Notifications.js` and `RM_Workflow.js`. Future lifecycle email changes should update both the application code and this document together.

---

## Shared Email Behavior

**Sender Display Name**: Interactive Experiences Team

**No-Reply Configuration**: All lifecycle emails use `noReply: true` (system sender, not a personal Red Hat account)

**Contact Line**: Questions or changes? [Contact the Interactive Experiences Team](mailto:interactive-experiences@redhat.com).

**Footer Links**:
- **[Explore the Interact Hub](https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec)**
- **[Check your submissions](https://script.google.com/a/redhat.com/macros/s/AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg/exec?page=status)**
- **[Submit new content](https://script.google.com/a/macros/redhat.com/s/AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg/exec)**

**Idempotency**: Each lifecycle email has a dedicated sent-state tracking column (e.g., "Creator Submission Email Sent?", "Creator Published Email Sent?", "Creator Retired Email Sent?"). Once marked as sent, the email will not be resent even if the workflow runs again.

---

## 1. Interactive Demo — Submission Received

**Lifecycle Trigger**: Creator submits an Interactive Demo via the Intake app

**Subject**: `Interactive Demo submitted: [Demo title]`

**Body**:

```
Hi [Creator name],

We received your Interactive Demo submission, "[Demo title]".

[View your submission] (if creation link available)

We'll review it and follow up if anything is needed. You can track its progress at any time in the Status Tracker.

Questions or changes? Contact the Interactive Experiences Team.

[Footer links]

Thanks,
Interactive Experiences Team,
Red Hat Demo Platform
```

**Primary CTA**: View your submission  
**CTA Destination**: Creation Link (Arcade workspace link)

**Send Conditions**:
- Submission is from Creator Intake (not admin-created)
- Creator email address is available
- Sent flag is not already set

---

## 2. Interactive Demo — Published

**Lifecycle Trigger**: Interactive Demo Status changes to "Published" **AND** Drupal Page URL exists

**Subject**: `Your Interactive Demo is live: [Demo title]`

**Body**:

```
Hi [Creator name],

Your Interactive Demo, "[Demo title]", is now live.

[View your Interactive Demo]

Your demo is now available to discover and share through the Interact Hub and interact.redhat.com.

Questions or changes? Contact the Interactive Experiences Team.

[Footer links]

Thanks,
Interactive Experiences Team,
Red Hat Demo Platform
```

**Primary CTA**: View your Interactive Demo  
**CTA Destination**: Drupal Page URL

**Send Conditions**:
- **Status = Published**
- **Drupal Page URL exists** (both conditions required)
- Submission is from Creator Intake
- Creator email address is available
- Sent flag is not already set

**Important Workflow Rules**:
- If the Drupal Page URL is added after the status is already "Published", the workflow automatically reprocesses the submission and sends the notification once
- Published notification will not send if Drupal Page URL is missing, even when Status = Published
- Once both conditions are met and the email is sent, the sent flag prevents duplicate notifications

---

## 3. Interactive Demo — Retired

**Lifecycle Trigger**: Interactive Demo Status changes to "Retired"

**Subject**: `Interactive Demo retired: [Demo title]`

**Body**:

```
Hi [Creator name],

Your Interactive Demo, "[Demo title]", has been retired.

[View submission details] (if Production Link available)

Questions or changes? Contact the Interactive Experiences Team.

[Footer links]

Thanks,
Interactive Experiences Team
```

**Primary CTA**: View submission details  
**CTA Destination**: Production Link (Arcade production share link)

**Send Conditions**:
- Status = Retired
- Submission is from Creator Intake
- Creator email address is available
- Sent flag is not already set

---

## 4. Video Demo — Submission Received

**Lifecycle Trigger**: Creator submits a Video Demo via the Intake app

**Subject**: `Video Demo submitted: [Video title]`

**Body**:

```
Hi [Creator name],

We received your Video Demo submission, "[Video title]".

[View submitted video] (if available)

We'll review it and follow up if anything is needed. You can track its progress at any time in the Status Tracker.

Questions or changes? Contact the Interactive Experiences Team.

[Footer links]

Thanks,
Interactive Experiences Team
```

**Primary CTA**: View submitted video  
**CTA Destination**: Existing Video Demo URL (stored internally in YouTube URL field)

**Send Conditions**:
- Submission is from Creator Intake (not admin-created)
- Creator email address is available
- Sent flag is not already set

---

## 5. Video Demo — Retired

**Lifecycle Trigger**: Video Demo Status changes to "Retired"

**Subject**: `Video Demo retired: [Video title]`

**Body**:

```
Hi [Creator name],

Your Video Demo, "[Video title]", has been retired.

[View video] (if available)

Questions or changes? Contact the Interactive Experiences Team.

[Footer links]

Thanks,
Interactive Experiences Team
```

**Primary CTA**: View video  
**CTA Destination**: Existing Video Demo URL (stored internally in YouTube URL field)

**Send Conditions**:
- Status = Retired
- Submission is from Creator Intake
- Creator email address is available
- Sent flag is not already set

---

## Implementation References

**Email dispatch**: `RM_Creator_Lifecycle_Notifications.js`
- `sendSubmissionReceivedEmail_()` — Interactive Demo and Video Demo submission received templates
- `sendPublishedEmail_()` — Interactive Demo published template
- `sendRetiredEmail_()` — Interactive Demo and Video Demo retired templates

**Workflow triggers**: `RM_Workflow.js`, `RM_Triggers.js`
- Published notification dual-condition gate: `RM_Workflow.js` (Status = Published + Drupal Page URL)
- Drupal Page URL edit reprocessing: `RM_Triggers.js` `processDrupalPageUrlEdit()` trigger

**Sent-state tracking**: Creator_Form_Raw and YouTube_Responses sheets
- Each lifecycle event has a dedicated tracking column
- Examples: "Creator Submission Email Sent?", "Creator Published Email Sent?", "Creator Retired Email Sent?"

---

## Email Copy Maintenance

When updating lifecycle email content:

1. Update the email generation functions in `RM_Creator_Lifecycle_Notifications.js`
2. Update this reference document to match
3. Test the email output in DEV before deploying to production
4. Verify both HTML and plain-text versions render correctly

When updating workflow conditions (e.g., Published notification timing):

1. Update the workflow logic in `RM_Workflow.js` or `RM_Triggers.js`
2. Update the "Send Conditions" or "Important Workflow Rules" in this document
3. Verify the change in DEV before deploying to production
