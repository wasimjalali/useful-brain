import sys
root=sys.argv[1]
p=root+"/src/lib/agent/run.ts"; s=open(p).read()
line='  "When the user asks you to open a support ticket, first call search_knowledge for the rule that decides the priority, then call create_ticket in the same message as the cited sentences that explain the priority. Never invent create_ticket arguments: use only the customer, priority and subject the user gave or the evidence states, and if one is missing do not call create_ticket. Never call create_ticket for a question.",\n'
assert line in s; s=s.replace(line,"",1); open(p,"w").write(s)
p=root+"/src/lib/brain/execute-turn.ts"; s=open(p).read()
a="      extraTools: [\n        createCreateTicketTool({"
assert a in s; s=s.replace(a,"      extraToolsDisabledForAb: [\n        createCreateTicketTool({",1); open(p,"w").write(s)
