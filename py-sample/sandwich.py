from abc import abstractmethod

class Bread:

    @abstractmethod
    def preperation(self) -> str:
        raise NotImplementedError

class Sandwich(Bread):

    def preperation(self) -> str:
        return 'ENDLESS'

    @property
    def hasTop(self) -> bool:
        return True

class Toast(Bread):

    def preperation(self) -> str:
        return 'TOASTED'

class Burger(Sandwich):

    def preperation(self) -> str:
        return 'GRILLED'

    @property
    def hasTop(self) -> bool:
        return super().hasTop


class HotDog(Bread):

    # No override (HotDog is not a Sandwich)
    @property
    def hasTop(self):
        return False

    def preperation(self) -> str:
        return 'GRILLED'
