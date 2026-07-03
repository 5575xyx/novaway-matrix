---
name: openspec
description: "Manages artifact generation, delta specs, and change lifecycle for PowersNexus. Generates proposal, specs, design, and tasks documents in .powersnexus/changes/ directory."
---

# OpenSpec Integration for PowersNexus

Manage the lifecycle of changes using structured artifacts and delta-based specifications.

## Directory Structure

All OpenSpec artifacts live in `.powersnexus/`:

```
.powersnexus/
├── specs/                        # Master specifications (source of truth)
│   └── <domain>/
│       └── spec.md
└── changes/
    ├── <change-name>/            # Active change
    │   ├── proposal.md           # Why and what
    │   ├── design.md             # Technical approach
    │   ├── tasks.md              # Implementation checklist
    │   └── delta-specs/          # Delta specs (incremental changes)
    │       └── <domain>/
    │           └── spec.md
    └── archive/                  # Completed changes
        └── YYYY-MM-DD-<name>/
```

## Core Functions

### 1. Initialize OpenSpec

**Check if `.powersnexus/` exists.** If not, create the directory structure:

```
.powersnexus/
├── specs/
└── changes/
    └── archive/
```

### 2. Create Change

Create a new change directory with artifact templates:

```
.powersnexus/changes/<change-name>/
├── proposal.md
├── design.md
├── tasks.md
└── delta-specs/
```

**Change naming:** Use kebab-case: `add-dark-mode`, `fix-login-bug`, `refactor-api`.

### 3. Generate Proposal

Create `proposal.md` with:
- **Intent**: What problem are we solving?
- **Scope**: In scope / Out of scope
- **Approach**: High-level technical direction

### 4. Generate Delta Specs

Create `delta-specs/<domain>/spec.md` with delta format:

```markdown
# Delta for <Domain>

## ADDED Requirements

### Requirement: <Name>
The system SHALL <behavior>.

#### Scenario: <Name>
- GIVEN <condition>
- WHEN <action>
- THEN <result>
- AND <additional result>

## MODIFIED Requirements

### Requirement: <Name>
The system SHALL <new behavior>.
(Previously: <old behavior>)

## REMOVED Requirements

### Requirement: <Name>
(Reason for removal)
```

**RFC 2119 keywords:**
- **MUST/SHALL** — absolute requirement
- **SHOULD** — recommended, exceptions exist
- **MAY** — optional

### 5. Generate Design

Create `design.md` with:
- **Technical Approach**: How to implement
- **Architecture Decisions**: Why specific choices
- **Data Flow**: Component interactions
- **File Changes**: List of files to create/modify

### 6. Generate Tasks

Create `tasks.md` with hierarchical checklist:

```markdown
# Tasks

## 1. <Section Name>
- [ ] 1.1 <Task description>
- [ ] 1.2 <Task description>

## 2. <Section Name>
- [ ] 2.1 <Task description>
- [ ] 2.2 <Task description>
```

**Task best practices:**
- Group related tasks under headings
- Use hierarchical numbering (1.1, 1.2, etc.)
- Keep tasks small enough to complete in one session
- Check tasks off as you complete them

### 7. Update Tasks

When a task is completed, update the checkbox from `[ ]` to `[x]`.

### 8. Archive Change

When a change is complete:
1. **Merge Delta Specs**: Apply ADDED/MODIFIED/REMOVED sections from `.powersnexus/changes/<name>/delta-specs/` to `.powersnexus/specs/`
2. **Move to Archive**: Move change folder to `.powersnexus/changes/archive/YYYY-MM-DD-<name>/`
3. **Preserve Context**: All artifacts remain intact for audit trail

**Delta Merge Rules:**
- **ADDED**: Append to the corresponding spec file
- **MODIFIED**: Replace the existing requirement
- **REMOVED**: Delete the requirement from the spec

## Workflow Integration

### Brainstorming → OpenSpec

After design approval in brainstorming:
1. Create change directory in `.powersnexus/changes/`
2. Generate proposal from brainstorming output
3. Generate delta specs based on requirements
4. Generate design document
5. Generate tasks checklist
6. Transition to writing-plans skill

### Writing Plans → OpenSpec

Read `.powersnexus/changes/<name>/tasks.md` as the task source.

### Subagent-Driven Development → OpenSpec

After each task completion:
1. Update the checkbox in tasks.md
2. Verify implementation against delta specs

### Finishing a Development Branch → OpenSpec

Before merging:
1. Archive the change
2. Merge delta specs to master specs
3. Move change to archive

## Templates

Use templates from `skills/openspec/templates/`:
- `proposal.md` — Proposal template
- `spec.md` — Delta spec template
- `design.md` — Design template
- `tasks.md` — Tasks template

## Schema

The default workflow schema:

```yaml
name: spec-driven
artifacts:
  - id: proposal
    generates: proposal.md
    requires: []
  
  - id: delta-specs
    generates: delta-specs/**/*.md
    requires: [proposal]
  
  - id: design
    generates: design.md
    requires: [proposal]
  
  - id: tasks
    generates: tasks.md
    requires: [specs, design]
```

Dependencies are enablers, not gates. You can create artifacts in any order that makes sense.