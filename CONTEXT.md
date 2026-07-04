# Texas Hold'em Match Recorder

This context describes the domain language for a Texas Hold'em match recording app.

## Language

**Cash Game**:
A type of game record, shown as 现金局 in Chinese UI, that settles each player's profit or loss from buy-ins, ending chips, and score value per hand.
_Avoid_: cash session, live cash

**Score**:
The settlement unit used to express a Cash Game player's profit, loss, and transfer amount.
_Avoid_: money, RMB, points

**Settlement Plan**:
A set of Score transfers that balances a valid Cash Game. It must be presented as exact when minimum-transfer optimality is guaranteed, or approximate when optimality is not guaranteed.
_Avoid_: transfer list, payment plan
